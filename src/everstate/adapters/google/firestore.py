"""Firestore (native mode): serverless store + colocated vector search (find_nearest).

Layout: tenants/{tenant}/memories/{memory_id}  — a subcollection per tenant, so tenant
isolation is structural and security rules can be written per tenant.
Requires a vector index on `embedding` (flat, COSINE) for the collection group, e.g.:

    gcloud firestore indexes composite create --collection-group=memories \
      --query-scope=COLLECTION --field-config=field-path=status,order=ASCENDING \
      --field-config=field-path=embedding,vector-config='{"dimension":"768","flat":"{}"}'

Max 2,048 dimensions.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from everstate.domain import AdapterUnavailable, DimensionMismatch, Hit, Memory, MemoryKind, MemoryStatus, Scope
from everstate.ports import IndexEntry

from ._sync import require_project, run_sync

try:
    from google.cloud import firestore
    from google.cloud.firestore_v1.base_query import FieldFilter
    from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
    from google.cloud.firestore_v1.vector import Vector as FsVector
except ImportError as exc:  # pragma: no cover
    raise AdapterUnavailable("Firestore adapters need `pip install 'everstate[firestore]'`") from exc


def _db(settings: Any, ctx: Any) -> Any:
    return ctx.resource("firestore", lambda: firestore.Client(project=require_project(settings),
                                                              database=settings.google.firestore_database))


class FirestoreMemoryStore:
    def __init__(self, db: Any, collection: str) -> None:
        self._db, self._collection = db, collection

    def _col(self, tenant_id: str) -> Any:
        return self._db.collection("tenants").document(tenant_id).collection(self._collection)

    def _doc(self, m: Memory) -> dict[str, Any]:
        data = m.to_dict(include_embedding=False)
        data["scope_key"] = m.scope.key
        if m.embedding is not None:
            data["embedding"] = FsVector(list(m.embedding))
        return data

    async def put(self, memory: Memory) -> None:
        await self.put_many([memory])

    async def put_many(self, memories: Sequence[Memory]) -> None:
        def write() -> None:
            for start in range(0, len(memories), 400):  # batch limit is 500 writes
                batch = self._db.batch()
                for m in memories[start:start + 400]:
                    batch.set(self._col(m.tenant_id).document(m.id), self._doc(m))
                batch.commit()

        await run_sync(write)

    @staticmethod
    def _from_snapshot(snap: Any) -> Memory:
        data = snap.to_dict()
        emb = data.pop("embedding", None)
        data["embedding"] = list(emb) if emb is not None else None
        return Memory.from_dict(data)

    async def get_many(self, tenant_id: str, ids: Sequence[str]) -> list[Memory]:
        def read() -> list[Memory]:
            refs = [self._col(tenant_id).document(i) for i in ids]
            snaps = {s.id: s for s in self._db.get_all(refs) if s.exists}
            return [self._from_snapshot(snaps[i]) for i in ids if i in snaps]

        return [m for m in await run_sync(read) if not m.expired] if ids else []

    async def find(self, tenant_id: str, *, scopes: Sequence[Scope] | None = None,
                   statuses: Sequence[MemoryStatus] | None = None, kinds: Sequence[MemoryKind] | None = None,
                   key: str | None = None, limit: int = 100) -> list[Memory]:
        def read() -> list[Memory]:
            q = self._col(tenant_id)
            if key is not None:
                q = q.where(filter=FieldFilter("key", "==", key))
            if statuses:
                q = q.where(filter=FieldFilter("status", "in", [s.value for s in statuses]))
            q = q.order_by("updated_at", direction=firestore.Query.DESCENDING).limit(limit * 3)
            return [self._from_snapshot(s) for s in q.stream()]

        scope_keys = {s.key for s in scopes} if scopes else None
        rows = await run_sync(read)
        return [m for m in rows if not m.expired and (scope_keys is None or m.scope.key in scope_keys)
                and (kinds is None or m.kind in kinds)][:limit]

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        existing = await self.get_many(tenant_id, ids)

        def remove() -> None:
            batch = self._db.batch()
            for i in ids:
                batch.delete(self._col(tenant_id).document(i))
            batch.commit()

        await run_sync(remove)
        return len(existing)


class FirestoreVectorIndex:
    colocated = True

    def __init__(self, db: Any, collection: str, dimensions: int) -> None:
        if dimensions > 2048:
            raise DimensionMismatch("Firestore vector search supports at most 2,048 dimensions")
        self.dimensions = dimensions
        self._store = FirestoreMemoryStore(db, collection)

    async def ensure(self) -> None:
        return None

    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None:
        return None

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        return 0

    async def search(self, tenant_id: str, vector: Sequence[float], *, k: int,
                     scope_keys: Sequence[str] | None = None, kinds: Sequence[str] | None = None) -> list[Hit]:
        def query() -> list[Hit]:
            q = self._store._col(tenant_id).where(filter=FieldFilter("status", "==", "active"))
            if scope_keys:
                q = q.where(filter=FieldFilter("scope_key", "in", list(scope_keys)[:30]))
            vq = q.find_nearest(vector_field="embedding", query_vector=FsVector(list(vector)),
                                distance_measure=DistanceMeasure.COSINE, limit=min(k, 1000),
                                distance_result_field="_dist")
            return [Hit(s.id, 1.0 - float(s.get("_dist"))) for s in vq.stream()
                    if not kinds or s.get("kind") in kinds]

        return await run_sync(query)


def build_store(settings: Any, ctx: Any) -> FirestoreMemoryStore:
    return FirestoreMemoryStore(_db(settings, ctx), settings.google.firestore_collection)


def build_index(settings: Any, ctx: Any) -> FirestoreVectorIndex:
    return FirestoreVectorIndex(_db(settings, ctx), settings.google.firestore_collection, settings.embedding.dimensions)
