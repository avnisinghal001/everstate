"""Cloud Spanner: system of record + colocated vector search.

Schema (see `ddl()`; also in sql/everstate_spanner.sql and terraform/spanner.tf):
  * one row per memory, PRIMARY KEY (TenantId, MemoryId): tenant-first keys keep a
    tenant's rows contiguous and every query tenant-bound
  * Embedding ARRAY<FLOAT32>(vector_length=>N) with a COSINE VECTOR INDEX (ANN, needs
    Enterprise edition); `spanner_search=exact` uses COSINE_DISTANCE KNN on any edition
  * ROW DELETION POLICY on ExpiresAt: session working memory is garbage-collected by
    Spanner itself
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Any, Mapping, Sequence

from everstate.domain import AdapterUnavailable, ConfigurationError, Hit, Memory, MemoryKind, MemoryStatus, Scope
from everstate.ports import IndexEntry

from ._sync import require_project, run_sync

try:
    from google.cloud import spanner
    from google.cloud.spanner_v1 import JsonObject, KeySet, param_types
except ImportError as exc:  # pragma: no cover
    raise AdapterUnavailable("Spanner adapters need `pip install google-cloud-spanner`") from exc

COLUMNS = (
    "TenantId", "MemoryId", "ScopeKey", "ScopeLevel", "Kind", "MemKey", "Content", "Confidence",
    "Status", "Embedding", "EmbeddingModel", "Doc", "CreatedAt", "UpdatedAt", "ExpiresAt",
    "Supersedes", "Version",
)


def ddl(table: str, vector_index: str, dimensions: int) -> list[str]:
    return [
        f"""CREATE TABLE {table} (
  TenantId STRING(128) NOT NULL,
  MemoryId STRING(64) NOT NULL,
  ScopeKey STRING(320) NOT NULL,
  ScopeLevel STRING(16) NOT NULL,
  Kind STRING(16) NOT NULL,
  MemKey STRING(256) NOT NULL,
  Content STRING(MAX) NOT NULL,
  Confidence FLOAT64 NOT NULL,
  Status STRING(16) NOT NULL,
  Embedding ARRAY<FLOAT32>(vector_length=>{dimensions}),
  EmbeddingModel STRING(128),
  Doc JSON NOT NULL,
  CreatedAt TIMESTAMP NOT NULL,
  UpdatedAt TIMESTAMP NOT NULL,
  ExpiresAt TIMESTAMP,
  Supersedes STRING(64),
  Version INT64 NOT NULL,
) PRIMARY KEY (TenantId, MemoryId),
  ROW DELETION POLICY (OLDER_THAN(ExpiresAt, INTERVAL 0 DAY))""",
        f"CREATE INDEX {table}ByKey ON {table}(TenantId, MemKey)",
        f"CREATE INDEX {table}ByUpdated ON {table}(TenantId, UpdatedAt DESC)",
        f"""CREATE VECTOR INDEX {vector_index} ON {table}(Embedding)
  STORING (ScopeKey, Kind, Status, ExpiresAt)
  WHERE Embedding IS NOT NULL
  OPTIONS (distance_type = 'COSINE')""",
    ]


def _ts(value: float | None) -> dt.datetime | None:
    return None if value is None else dt.datetime.fromtimestamp(value, tz=dt.timezone.utc)


def _database(settings: Any, ctx: Any) -> Any:
    g = settings.google

    def build() -> Any:
        client = spanner.Client(project=require_project(settings))
        return client.instance(g.spanner_instance).database(g.spanner_database)

    return ctx.resource("spanner", build)


class SpannerMemoryStore:
    def __init__(self, database: Any, table: str) -> None:
        self._db = database
        self._table = table

    def _row(self, m: Memory) -> list[Any]:
        return [
            m.tenant_id, m.id, m.scope.key, m.scope.level.value, m.kind.value, m.key, m.content,
            float(m.confidence), m.status.value, list(m.embedding) if m.embedding is not None else None,
            m.embedding_model, JsonObject(m.to_dict(include_embedding=False)), _ts(m.created_at),
            _ts(m.updated_at), _ts(m.expires_at), m.supersedes, m.version,
        ]

    async def put(self, memory: Memory) -> None:
        await self.put_many([memory])

    async def put_many(self, memories: Sequence[Memory]) -> None:
        if not memories:
            return

        def write() -> None:
            with self._db.batch() as batch:
                batch.insert_or_update(self._table, columns=COLUMNS, values=[self._row(m) for m in memories])

        await run_sync(write)

    async def _query(self, sql: str, params: Mapping[str, Any], types: Mapping[str, Any]) -> list[Memory]:
        def read() -> list[Memory]:
            with self._db.snapshot() as snap:
                rows = snap.execute_sql(sql, params=dict(params), param_types=dict(types))
                out = []
                for doc, emb in rows:
                    data = dict(doc) if not isinstance(doc, str) else json.loads(doc)
                    data["embedding"] = list(emb) if emb is not None else None
                    out.append(Memory.from_dict(data))
                return out

        return await run_sync(read)

    async def get_many(self, tenant_id: str, ids: Sequence[str]) -> list[Memory]:
        if not ids:
            return []
        sql = (f"SELECT Doc, Embedding FROM {self._table} WHERE TenantId = @tenant AND MemoryId IN UNNEST(@ids) "
               "AND (ExpiresAt IS NULL OR ExpiresAt > CURRENT_TIMESTAMP())")
        rows = await self._query(sql, {"tenant": tenant_id, "ids": list(ids)},
                                 {"tenant": param_types.STRING, "ids": param_types.Array(param_types.STRING)})
        order = {i: n for n, i in enumerate(ids)}
        return sorted(rows, key=lambda m: order.get(m.id, 0))

    async def find(
        self,
        tenant_id: str,
        *,
        scopes: Sequence[Scope] | None = None,
        statuses: Sequence[MemoryStatus] | None = None,
        kinds: Sequence[MemoryKind] | None = None,
        key: str | None = None,
        limit: int = 100,
    ) -> list[Memory]:
        where = ["TenantId = @tenant", "(ExpiresAt IS NULL OR ExpiresAt > CURRENT_TIMESTAMP())"]
        params: dict[str, Any] = {"tenant": tenant_id, "limit": limit}
        types: dict[str, Any] = {"tenant": param_types.STRING, "limit": param_types.INT64}
        for name, values, col in (("scopes", [s.key for s in scopes or []], "ScopeKey"),
                                  ("statuses", [s.value for s in statuses or []], "Status"),
                                  ("kinds", [k.value for k in kinds or []], "Kind")):
            if values:
                where.append(f"{col} IN UNNEST(@{name})")
                params[name] = values
                types[name] = param_types.Array(param_types.STRING)
        if key is not None:
            where.append("MemKey = @key")
            params["key"], types["key"] = key, param_types.STRING
        sql = f"SELECT Doc, Embedding FROM {self._table} WHERE {' AND '.join(where)} ORDER BY UpdatedAt DESC LIMIT @limit"
        return await self._query(sql, params, types)

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        if not ids:
            return 0
        existing = await self.get_many(tenant_id, ids)

        def remove() -> None:
            with self._db.batch() as batch:
                batch.delete(self._table, KeySet(keys=[[tenant_id, i] for i in ids]))

        await run_sync(remove)
        return len(existing)

    async def health(self) -> Mapping[str, Any]:
        def ping() -> bool:
            with self._db.snapshot() as snap:
                return list(snap.execute_sql("SELECT 1"))[0][0] == 1

        try:
            return {"ok": await run_sync(ping), "backend": "spanner"}
        except Exception as exc:  # pragma: no cover - network
            return {"ok": False, "backend": "spanner", "error": str(exc)}


class SpannerVectorIndex:
    """Vectors live in the memory rows (colocated): upsert/delete are no-ops."""

    colocated = True

    def __init__(self, database: Any, table: str, vector_index: str, dimensions: int, mode: str, leaves: int) -> None:
        self.dimensions = dimensions
        self._db, self._table, self._vix = database, table, vector_index
        self._mode, self._leaves = mode, leaves

    async def ensure(self) -> None:
        return None   # schema is applied by `everstate migrate` / Terraform

    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None:
        return None

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        return 0

    def _sql(self, scoped: bool, kinds: bool) -> str:
        if self._mode == "ann":
            dist = f"""APPROX_COSINE_DISTANCE(Embedding, @q, options => JSON '{{"num_leaves_to_search": {self._leaves}}}')"""
            source = f"{self._table}@{{FORCE_INDEX={self._vix}}}"
        elif self._mode == "exact":
            dist, source = "COSINE_DISTANCE(Embedding, @q)", self._table
        else:
            raise ConfigurationError(f"spanner_search must be 'ann' or 'exact', got {self._mode!r}")
        where = ["Embedding IS NOT NULL", "TenantId = @tenant", "Status = 'active'",
                 "(ExpiresAt IS NULL OR ExpiresAt > CURRENT_TIMESTAMP())"]
        if scoped:
            where.append("ScopeKey IN UNNEST(@scopes)")
        if kinds:
            where.append("Kind IN UNNEST(@kinds)")
        return f"SELECT MemoryId, {dist} AS Dist FROM {source} WHERE {' AND '.join(where)} ORDER BY {dist} LIMIT @k"

    async def search(self, tenant_id: str, vector: Sequence[float], *, k: int,
                     scope_keys: Sequence[str] | None = None, kinds: Sequence[str] | None = None) -> list[Hit]:
        params: dict[str, Any] = {"q": list(vector), "tenant": tenant_id, "k": k}
        types: dict[str, Any] = {"q": param_types.Array(param_types.FLOAT32), "tenant": param_types.STRING,
                                 "k": param_types.INT64}
        if scope_keys:
            params["scopes"], types["scopes"] = list(scope_keys), param_types.Array(param_types.STRING)
        if kinds:
            params["kinds"], types["kinds"] = list(kinds), param_types.Array(param_types.STRING)
        sql = self._sql(bool(scope_keys), bool(kinds))

        def read() -> list[Hit]:
            with self._db.snapshot() as snap:
                return [Hit(mid, 1.0 - float(dist)) for mid, dist in snap.execute_sql(sql, params=params, param_types=types)]

        return await run_sync(read)


def build_store(settings: Any, ctx: Any) -> SpannerMemoryStore:
    return SpannerMemoryStore(_database(settings, ctx), settings.google.spanner_table)


def build_index(settings: Any, ctx: Any) -> SpannerVectorIndex:
    g = settings.google
    return SpannerVectorIndex(_database(settings, ctx), g.spanner_table, g.spanner_vector_index,
                              settings.embedding.dimensions, g.spanner_search, g.spanner_num_leaves_to_search)
