"""Redis vector search, two engines behind one VectorIndex port.

query_engine  FT.CREATE / FT.SEARCH KNN over the memory hashes (colocated with the
              Redis store). Works on Redis Stack / Redis Open Source with the Query
              Engine, Redis Cloud, and Google Memorystore for Valkey and for Redis
              Cluster (valkey-search / RediSearch-compatible FT.* subset: TAG, NUMERIC,
              VECTOR HNSW|FLAT, KNN with pre-filter).
vectorset     Redis 8 core Vector Sets: one HNSW set per tenant (VADD / VSIM / VREM)
              with JSON attributes for scope/kind/expiry filtering.

`auto` picks the Query Engine when the server exposes it, else Vector Sets.
"""

from __future__ import annotations

import json
import time
from typing import Any, Mapping, Sequence

from everstate.domain import AdapterUnavailable, Hit
from everstate.ports import IndexEntry
from everstate.vectors import check_dimensions, to_float32_bytes

from .client import Keys, scope_tag, shared_client, tenant_tag


def _scope_tags(scope_keys: Sequence[str]) -> str:
    return "|".join(scope_tag(s) for s in scope_keys)


class _QueryEngine:
    name = "query_engine"
    colocated_with_store = True

    def __init__(self, r: Any, keys: Keys, dims: int, rs: Any) -> None:
        self._r, self._k, self._dims, self._rs = r, keys, dims, rs

    async def ensure(self) -> None:
        idx = self._k.search_index()
        try:
            await self._r.execute_command("FT.INFO", idx)
            return
        except Exception:
            pass
        algo = self._rs.index_algorithm
        params = ["TYPE", "FLOAT32", "DIM", self._dims, "DISTANCE_METRIC", "COSINE"]
        if algo == "HNSW":
            params += ["M", self._rs.hnsw_m, "EF_CONSTRUCTION", self._rs.hnsw_ef_construction]
        await self._r.execute_command(
            "FT.CREATE", idx, "ON", "HASH", "PREFIX", 1, self._k.memory_prefix(),
            "SCHEMA", "t", "TAG", "s", "TAG", "k", "TAG", "st", "TAG",
            "vec", "VECTOR", algo, len(params), *params,
        )

    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None:
        async with self._r.pipeline(transaction=False) as pipe:
            for e in entries:
                key = self._k.memory(tenant_id, e.memory_id)
                pipe.hset(key, mapping={"t": tenant_tag(tenant_id), "s": scope_tag(e.scope_key),
                                        "k": e.kind, "st": "active", "vec": to_float32_bytes(e.vector)})
                if e.expires_at is not None:
                    pipe.pexpireat(key, int(e.expires_at * 1000))
            await pipe.execute()

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        removed = 0
        for i in ids:
            key = self._k.memory(tenant_id, i)
            removed += int(await self._r.hdel(key, "vec"))
            if not await self._r.hexists(key, "doc"):   # index-only entry: drop the whole hash
                await self._r.delete(key)
        return removed

    async def search(self, tenant_id: str, vector: Sequence[float], *, k: int,
                     scope_keys: Sequence[str] | None, kinds: Sequence[str] | None) -> list[Hit]:
        filters = [f"@t:{{{tenant_tag(tenant_id)}}}", "@st:{active}"]
        if scope_keys:
            filters.append(f"@s:{{{_scope_tags(scope_keys)}}}")
        if kinds:
            filters.append(f"@k:{{{'|'.join(kinds)}}}")
        query = f"({' '.join(filters)})=>[KNN {k} @vec $vec EF_RUNTIME {self._rs.hnsw_ef_runtime} AS dist]"
        raw = await self._r.execute_command(
            "FT.SEARCH", self._k.search_index(), query, "PARAMS", 2, "vec", to_float32_bytes(vector),
            "SORTBY", "dist", "RETURN", 1, "dist", "LIMIT", 0, k, "DIALECT", 2,
        )
        hits: list[Hit] = []
        # RESP2 layout: [total, key1, [field, value], key2, [...], ...]
        for i in range(1, len(raw), 2):
            doc_key = raw[i].decode() if isinstance(raw[i], bytes) else str(raw[i])
            fields = raw[i + 1]
            dist = float(fields[fields.index(b"dist") + 1]) if b"dist" in fields else 1.0
            hits.append(Hit(doc_key.rsplit(":", 1)[-1], 1.0 - dist))
        return hits


class _VectorSets:
    name = "vectorset"
    colocated_with_store = False

    def __init__(self, r: Any, keys: Keys, dims: int, rs: Any) -> None:
        self._r, self._k, self._dims, self._rs = r, keys, dims, rs

    async def ensure(self) -> None:
        return None   # a vector set is created by its first VADD

    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None:
        key = self._k.vectorset(tenant_id)
        async with self._r.pipeline(transaction=False) as pipe:
            for e in entries:
                attrs = json.dumps({"scope": e.scope_key, "kind": e.kind, "exp": e.expires_at or 0})
                pipe.execute_command("VADD", key, "FP32", to_float32_bytes(e.vector), e.memory_id,
                                     self._rs.vectorset_quant, "M", self._rs.hnsw_m,
                                     "EF", self._rs.hnsw_ef_construction, "SETATTR", attrs)
            await pipe.execute()

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        key = self._k.vectorset(tenant_id)
        async with self._r.pipeline(transaction=False) as pipe:
            for i in ids:
                pipe.execute_command("VREM", key, i)
            return sum(int(x) for x in await pipe.execute())

    async def search(self, tenant_id: str, vector: Sequence[float], *, k: int,
                     scope_keys: Sequence[str] | None, kinds: Sequence[str] | None) -> list[Hit]:
        clauses = [f"(.exp == 0 or .exp > {time.time():.3f})"]
        if scope_keys:
            clauses.append(f".scope in {json.dumps(list(scope_keys))}")
        if kinds:
            clauses.append(f".kind in {json.dumps(list(kinds))}")
        raw = await self._r.execute_command(
            "VSIM", self._k.vectorset(tenant_id), "FP32", to_float32_bytes(vector),
            "WITHSCORES", "COUNT", k, "EF", max(self._rs.hnsw_ef_runtime, k), "FILTER", " and ".join(clauses),
        )
        # Reply is either {element: score} (parsed) or [element, score, ...] (raw); score = (1 + cos) / 2
        pairs = raw.items() if isinstance(raw, dict) else zip(raw[::2], raw[1::2])
        hits = [Hit(e.decode() if isinstance(e, bytes) else str(e), 2.0 * float(sc) - 1.0) for e, sc in pairs]
        return sorted(hits, key=lambda h: h.similarity, reverse=True)


class RedisVectorIndex:
    def __init__(self, client: Any, keys: Keys, dimensions: int, redis_settings: Any) -> None:
        self.dimensions = dimensions
        self._r, self._keys, self._rs = client, keys, redis_settings
        self._engine: _QueryEngine | _VectorSets | None = None

    @property
    def colocated(self) -> bool:
        return False   # always maintains its own vector fields / sets

    @property
    def engine(self) -> str | None:
        return self._engine.name if self._engine else None

    async def _resolve(self) -> _QueryEngine | _VectorSets:
        if self._engine is not None:
            return self._engine
        choice = self._rs.vector_backend
        if choice == "auto":
            names = await self._module_names()
            if names & {"search", "ft", "valkey-search"}:
                choice = "query_engine"
            elif "vectorset" in names:
                choice = "vectorset"
            else:
                raise AdapterUnavailable("Redis server has neither the Query Engine (FT.*) nor Vector Sets (VADD)")
        engine_cls = _QueryEngine if choice == "query_engine" else _VectorSets
        self._engine = engine_cls(self._r, self._keys, self.dimensions, self._rs)
        await self._engine.ensure()
        return self._engine

    async def _module_names(self) -> set[str]:
        """MODULE LIST arrives parsed (dicts) or raw (flat lists) depending on client/protocol."""
        names: set[str] = set()
        for m in await self._r.execute_command("MODULE", "LIST"):
            info = m if isinstance(m, dict) else dict(zip(m[::2], m[1::2]))
            raw = info.get(b"name", info.get("name", b""))
            names.add((raw.decode() if isinstance(raw, bytes) else str(raw)).lower())
        return names

    async def ensure(self) -> None:
        await self._resolve()

    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None:
        if not entries:
            return
        for e in entries:
            check_dimensions(e.vector, self.dimensions)
        await (await self._resolve()).upsert(tenant_id, entries)

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        return await (await self._resolve()).delete(tenant_id, ids) if ids else 0

    async def search(self, tenant_id: str, vector: Sequence[float], *, k: int,
                     scope_keys: Sequence[str] | None = None, kinds: Sequence[str] | None = None) -> list[Hit]:
        check_dimensions(vector, self.dimensions)
        engine = await self._resolve()
        try:
            return await engine.search(tenant_id, vector, k=k, scope_keys=scope_keys, kinds=kinds)
        except Exception as exc:
            if "not exist" in str(exc).lower() or "no such" in str(exc).lower():
                return []   # tenant has no vectors yet
            raise

    async def health(self) -> Mapping[str, Any]:
        try:
            engine = await self._resolve()
            return {"ok": True, "backend": "redis", "engine": engine.name}
        except Exception as exc:  # pragma: no cover - network
            return {"ok": False, "backend": "redis", "error": str(exc)}


def build_index(settings: Any, ctx: Any) -> RedisVectorIndex:
    return RedisVectorIndex(shared_client(settings, ctx), Keys(settings.redis.key_prefix),
                            settings.embedding.dimensions, settings.redis)
