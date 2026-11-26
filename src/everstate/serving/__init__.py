"""Serving-path composition: caching and the Redis hot tier.

CachedEmbedder   memoises embeddings by (model, dims, task, sha256(text)); a repeated
                 query never pays the embedding API twice.
ReplicatedStore  durable primary (Spanner/Firestore) + Redis replica. Writes go to the
                 primary first, then the replica (write-through); point reads are served
                 from the replica and backfilled on miss (read-through); listings go to
                 the primary, which is authoritative.
"""

from __future__ import annotations

import hashlib
from typing import Any, Mapping, Sequence

from everstate.domain import Memory, MemoryKind, MemoryStatus, Scope
from everstate.ports import Cache, EmbedTask, Embedder, MemoryStore
from everstate.vectors import from_float32_bytes, to_float32_bytes


class CachedEmbedder:
    def __init__(self, inner: Embedder, cache: Cache, ttl_seconds: int) -> None:
        self.inner = inner
        self.model_id = inner.model_id
        self.dimensions = inner.dimensions
        self._cache, self._ttl = cache, ttl_seconds
        self.hits = self.misses = 0

    def _key(self, text: str, task: EmbedTask) -> str:
        digest = hashlib.sha256(text.encode()).hexdigest()
        return f"emb:{self.model_id}:{self.dimensions}:{task.value}:{digest}"

    async def embed(self, texts: Sequence[str], *, task: EmbedTask = EmbedTask.DOCUMENT) -> list[list[float]]:
        out: list[list[float] | None] = [None] * len(texts)
        missing: list[int] = []
        for i, t in enumerate(texts):
            raw = await self._cache.get(self._key(t, task))
            if raw is None:
                missing.append(i)
            else:
                out[i] = from_float32_bytes(raw)
        self.hits += len(texts) - len(missing)
        self.misses += len(missing)
        if missing:
            fresh = await self.inner.embed([texts[i] for i in missing], task=task)
            for i, vec in zip(missing, fresh):
                out[i] = vec
                await self._cache.set(self._key(texts[i], task), to_float32_bytes(vec), ttl_seconds=self._ttl)
        return [v for v in out if v is not None]

    async def health(self) -> Mapping[str, Any]:
        inner = getattr(self.inner, "health", None)
        base = dict(await inner()) if inner else {"ok": True}
        return {**base, "cache_hits": self.hits, "cache_misses": self.misses}


class ReplicatedStore:
    def __init__(self, primary: MemoryStore, replica: MemoryStore) -> None:
        self.primary, self.replica = primary, replica

    async def put(self, memory: Memory) -> None:
        await self.put_many([memory])

    async def put_many(self, memories: Sequence[Memory]) -> None:
        await self.primary.put_many(memories)      # durability first
        await self.replica.put_many(memories)

    async def get_many(self, tenant_id: str, ids: Sequence[str]) -> list[Memory]:
        found = {m.id: m for m in await self.replica.get_many(tenant_id, ids)}
        missing = [i for i in ids if i not in found]
        if missing:
            fetched = await self.primary.get_many(tenant_id, missing)
            if fetched:
                await self.replica.put_many(fetched)    # read-through backfill
            found.update({m.id: m for m in fetched})
        return [found[i] for i in ids if i in found]

    async def find(self, tenant_id: str, *, scopes: Sequence[Scope] | None = None,
                   statuses: Sequence[MemoryStatus] | None = None, kinds: Sequence[MemoryKind] | None = None,
                   key: str | None = None, limit: int = 100) -> list[Memory]:
        return await self.primary.find(tenant_id, scopes=scopes, statuses=statuses, kinds=kinds, key=key, limit=limit)

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        removed = await self.primary.delete(tenant_id, ids)
        await self.replica.delete(tenant_id, ids)
        return removed

    async def health(self) -> Mapping[str, Any]:
        async def probe(store: Any) -> Mapping[str, Any]:
            fn = getattr(store, "health", None)
            return await fn() if fn else {"ok": True}

        p, r = await probe(self.primary), await probe(self.replica)
        return {"ok": bool(p.get("ok")) and bool(r.get("ok")), "primary": p, "replica": r}
