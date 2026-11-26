"""Redis as the memory system of record (or as the hot serving replica of one).

Layout per tenant (all keys share the `{tenant}` hash tag):
    es:m:{t}:<id>    HASH  doc=<json>, t, s, k, st, u   (+ vec when the Query Engine index is colocated)
    es:z:{t}         ZSET  id -> updated_at              (newest-first listing)
    es:k:{t}:<key>   SET   ids sharing a canonical key   (arbitration / supersession lookups)
Session-scope memories get PEXPIREAT so working memory evaporates on its own.
"""

from __future__ import annotations

import json
from typing import Any, Mapping, Sequence

from everstate.domain import Memory, MemoryKind, MemoryStatus, Scope

from everstate.vectors import from_float32_bytes, to_float32_bytes

from .client import Keys, scope_tag, shared_client, tenant_tag

_SCAN_BATCH = 200
_SCAN_CAP = 5_000


class RedisMemoryStore:
    def __init__(self, client: Any, keys: Keys) -> None:
        self._r = client
        self._k = keys

    def _fields(self, m: Memory) -> dict[str, Any]:
        fields = {
            "doc": json.dumps(m.to_dict(include_embedding=False), separators=(",", ":")),
            "t": tenant_tag(m.tenant_id),
            "s": scope_tag(m.scope.key),
            "k": m.kind.value,
            "st": m.status.value,
            "u": m.updated_at,
        }
        if m.embedding is not None:
            fields["emb"] = to_float32_bytes(m.embedding)   # store's copy; the index keeps its own
        return fields

    def _write(self, pipe: Any, m: Memory) -> None:
        key = self._k.memory(m.tenant_id, m.id)
        pipe.hset(key, mapping=self._fields(m))
        pipe.zadd(self._k.timeline(m.tenant_id), {m.id: m.updated_at})
        pipe.sadd(self._k.by_key(m.tenant_id, m.key), m.id)
        if m.expires_at is not None:
            pipe.pexpireat(key, int(m.expires_at * 1000))

    async def put(self, memory: Memory) -> None:
        await self.put_many([memory])

    async def put_many(self, memories: Sequence[Memory]) -> None:
        if not memories:
            return
        async with self._r.pipeline(transaction=False) as pipe:
            for m in memories:
                self._write(pipe, m)
            await pipe.execute()

    async def get_many(self, tenant_id: str, ids: Sequence[str]) -> list[Memory]:
        if not ids:
            return []
        async with self._r.pipeline(transaction=False) as pipe:
            for i in ids:
                pipe.hmget(self._k.memory(tenant_id, i), ["doc", "emb"])
            rows = await pipe.execute()
        out = []
        for doc, emb in rows:
            if doc:
                data = json.loads(doc)
                if emb:
                    data["embedding"] = from_float32_bytes(emb)
                m = Memory.from_dict(data)
                if not m.expired:
                    out.append(m)
        return out

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
        scope_keys = {s.key for s in scopes} if scopes else None

        def keep(m: Memory) -> bool:
            return (
                (scope_keys is None or m.scope.key in scope_keys)
                and (statuses is None or m.status in statuses)
                and (kinds is None or m.kind in kinds)
                and (key is None or m.key == key)
            )

        if key is not None:
            ids = [i.decode() for i in await self._r.smembers(self._k.by_key(tenant_id, key))]
            found = [m for m in await self.get_many(tenant_id, ids) if keep(m)]
            found.sort(key=lambda m: m.updated_at, reverse=True)
            return found[:limit]

        out: list[Memory] = []
        timeline = self._k.timeline(tenant_id)
        stale: list[str] = []
        for start in range(0, _SCAN_CAP, _SCAN_BATCH):
            ids = [i.decode() for i in await self._r.zrevrange(timeline, start, start + _SCAN_BATCH - 1)]
            if not ids:
                break
            batch = {m.id: m for m in await self.get_many(tenant_id, ids)}
            stale += [i for i in ids if i not in batch]
            out += [m for i in ids if (m := batch.get(i)) is not None and keep(m)]
            if len(out) >= limit:
                break
        if stale:  # expired session memories: lazily trim the timeline
            await self._r.zrem(timeline, *stale)
        return out[:limit]

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        if not ids:
            return 0
        docs = await self.get_many(tenant_id, ids)
        async with self._r.pipeline(transaction=False) as pipe:
            for i in ids:
                pipe.delete(self._k.memory(tenant_id, i))
            pipe.zrem(self._k.timeline(tenant_id), *ids)
            for m in docs:
                pipe.srem(self._k.by_key(tenant_id, m.key), m.id)
            results = await pipe.execute()
        return sum(int(r) for r in results[: len(ids)])

    async def health(self) -> Mapping[str, Any]:
        try:
            return {"ok": bool(await self._r.ping()), "backend": "redis"}
        except Exception as exc:  # pragma: no cover - network
            return {"ok": False, "backend": "redis", "error": str(exc)}


def build_store(settings: Any, ctx: Any) -> RedisMemoryStore:
    return RedisMemoryStore(shared_client(settings, ctx), Keys(settings.redis.key_prefix))
