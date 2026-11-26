"""Managed vector databases over their REST APIs (httpx only, no vendor SDK).

Qdrant     one collection, cosine distance. Every point carries a payload
           {tenant, memory_id, scope, kind, exp}; every query filters on tenant, so
           isolation is enforced server-side. Point ids are UUIDv5(tenant/memory_id).
           Payload indexes on `tenant`, `scope`, `kind` (keyword) and `exp` (float) are
           created by ensure().
               EVERSTATE_INDEX=qdrant  EVERSTATE_QDRANT_URL=https://…:6333  QDRANT_API_KEY=…

Pinecone   serverless index with metric=cosine and matching dimension; one namespace per
           tenant (Pinecone's recommended multi-tenancy), metadata {scope, kind, exp}.
               EVERSTATE_INDEX=pinecone  EVERSTATE_PINECONE_HOST=https://<index>.svc.<region>.pinecone.io
               PINECONE_API_KEY=…

Both return cosine similarity as the hit score. Entries without expiry store exp=1e12 so
"exp > now" is a single range filter.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any, Mapping, Sequence

import httpx

from everstate.domain import AdapterUnavailable, ConfigurationError, Hit
from everstate.ports import IndexEntry
from everstate.vectors import check_dimensions

NEVER = 1e12
_NS = uuid.UUID("6b8a7f62-2f3c-4a3e-9a51-4f1c2b9e0d11")


def _tenant_tag(tenant_id: str) -> str:
    return hashlib.sha1(tenant_id.encode()).hexdigest()[:16]


class QdrantVectorIndex:
    colocated = False

    def __init__(self, client: httpx.AsyncClient, collection: str, dimensions: int) -> None:
        self.dimensions = dimensions
        self._http, self._col = client, collection

    @staticmethod
    def point_id(tenant_id: str, memory_id: str) -> str:
        return str(uuid.uuid5(_NS, f"{tenant_id}/{memory_id}"))

    async def _call(self, method: str, path: str, json: Any = None) -> Any:
        try:
            resp = await self._http.request(method, path, json=json)
        except httpx.HTTPError as exc:
            raise AdapterUnavailable(f"Qdrant unreachable: {exc}") from exc
        if resp.status_code >= 400:
            raise AdapterUnavailable(f"Qdrant {method} {path} -> {resp.status_code}: {resp.text[:300]}")
        return resp.json().get("result")

    async def ensure(self) -> None:
        resp = await self._http.get(f"/collections/{self._col}/exists")
        if resp.status_code == 200 and resp.json().get("result", {}).get("exists"):
            return
        await self._call("PUT", f"/collections/{self._col}", {"vectors": {"size": self.dimensions, "distance": "Cosine"}})
        for field, schema in (("tenant", "keyword"), ("scope", "keyword"), ("kind", "keyword"), ("exp", "float")):
            await self._call("PUT", f"/collections/{self._col}/index?wait=true",
                             {"field_name": field, "field_schema": schema})

    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None:
        if not entries:
            return
        points = []
        for e in entries:
            check_dimensions(e.vector, self.dimensions)
            points.append({"id": self.point_id(tenant_id, e.memory_id), "vector": list(e.vector),
                           "payload": {"tenant": _tenant_tag(tenant_id), "memory_id": e.memory_id,
                                       "scope": e.scope_key, "kind": e.kind, "exp": e.expires_at or NEVER}})
        await self._call("PUT", f"/collections/{self._col}/points?wait=true", {"points": points})

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        if ids:
            await self._call("POST", f"/collections/{self._col}/points/delete?wait=true",
                             {"points": [self.point_id(tenant_id, i) for i in ids]})
        return len(ids)

    async def search(self, tenant_id: str, vector: Sequence[float], *, k: int,
                     scope_keys: Sequence[str] | None = None, kinds: Sequence[str] | None = None) -> list[Hit]:
        check_dimensions(vector, self.dimensions)
        must: list[dict[str, Any]] = [{"key": "tenant", "match": {"value": _tenant_tag(tenant_id)}},
                                      {"key": "exp", "range": {"gt": time.time()}}]
        if scope_keys:
            must.append({"key": "scope", "match": {"any": list(scope_keys)}})
        if kinds:
            must.append({"key": "kind", "match": {"any": list(kinds)}})
        result = await self._call("POST", f"/collections/{self._col}/points/query",
                                  {"query": list(vector), "limit": k, "filter": {"must": must}, "with_payload": ["memory_id"]})
        points = result.get("points", []) if isinstance(result, dict) else (result or [])
        return [Hit(p["payload"]["memory_id"], float(p["score"])) for p in points]

    async def health(self) -> Mapping[str, Any]:
        try:
            resp = await self._http.get(f"/collections/{self._col}")
            return {"ok": resp.status_code == 200, "backend": "qdrant", "collection": self._col}
        except httpx.HTTPError as exc:
            return {"ok": False, "backend": "qdrant", "error": str(exc)}


class PineconeVectorIndex:
    colocated = False

    def __init__(self, client: httpx.AsyncClient, dimensions: int) -> None:
        self.dimensions = dimensions
        self._http = client

    async def _post(self, path: str, body: Mapping[str, Any]) -> Any:
        try:
            resp = await self._http.post(path, json=dict(body))
        except httpx.HTTPError as exc:
            raise AdapterUnavailable(f"Pinecone unreachable: {exc}") from exc
        if resp.status_code >= 400:
            raise AdapterUnavailable(f"Pinecone {path} -> {resp.status_code}: {resp.text[:300]}")
        return resp.json() if resp.content else {}

    async def ensure(self) -> None:
        stats = await self._post("/describe_index_stats", {})
        dim = stats.get("dimension")
        if dim and int(dim) != self.dimensions:
            raise ConfigurationError(f"Pinecone index has dimension {dim}, Everstate is configured for {self.dimensions}")

    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None:
        vectors = []
        for e in entries:
            check_dimensions(e.vector, self.dimensions)
            vectors.append({"id": e.memory_id, "values": list(e.vector),
                            "metadata": {"scope": e.scope_key, "kind": e.kind, "exp": e.expires_at or NEVER}})
        for start in range(0, len(vectors), 100):   # Pinecone recommends ≤100 vectors per upsert
            await self._post("/vectors/upsert", {"vectors": vectors[start:start + 100], "namespace": _tenant_tag(tenant_id)})

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        if ids:
            await self._post("/vectors/delete", {"ids": list(ids), "namespace": _tenant_tag(tenant_id)})
        return len(ids)

    async def search(self, tenant_id: str, vector: Sequence[float], *, k: int,
                     scope_keys: Sequence[str] | None = None, kinds: Sequence[str] | None = None) -> list[Hit]:
        check_dimensions(vector, self.dimensions)
        flt: dict[str, Any] = {"exp": {"$gt": time.time()}}
        if scope_keys:
            flt["scope"] = {"$in": list(scope_keys)}
        if kinds:
            flt["kind"] = {"$in": list(kinds)}
        data = await self._post("/query", {"vector": list(vector), "topK": k, "namespace": _tenant_tag(tenant_id),
                                           "filter": flt, "includeValues": False, "includeMetadata": False})
        return [Hit(m["id"], float(m["score"])) for m in data.get("matches", [])]

    async def health(self) -> Mapping[str, Any]:
        try:
            await self._post("/describe_index_stats", {})
            return {"ok": True, "backend": "pinecone"}
        except AdapterUnavailable as exc:
            return {"ok": False, "backend": "pinecone", "error": str(exc)}


def build_qdrant(settings: Any, ctx: Any) -> QdrantVectorIndex:
    v = settings.vectordb
    headers = {"api-key": v.qdrant_api_key} if v.qdrant_api_key else {}
    client = httpx.AsyncClient(base_url=v.qdrant_url.rstrip("/"), headers=headers, timeout=v.timeout_seconds)
    ctx.on_close(client.aclose)
    return QdrantVectorIndex(client, v.qdrant_collection, settings.embedding.dimensions)


def build_pinecone(settings: Any, ctx: Any) -> PineconeVectorIndex:
    v = settings.vectordb
    if not (v.pinecone_host and v.pinecone_api_key):
        raise ConfigurationError("set EVERSTATE_PINECONE_HOST and PINECONE_API_KEY for the pinecone index")
    client = httpx.AsyncClient(base_url=v.pinecone_host.rstrip("/"), timeout=v.timeout_seconds,
                               headers={"Api-Key": v.pinecone_api_key, "X-Pinecone-API-Version": v.pinecone_api_version})
    ctx.on_close(client.aclose)
    return PineconeVectorIndex(client, settings.embedding.dimensions)
