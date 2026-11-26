"""Redis 8 / Memorystore adapters: store, vector index, cache, event stream.

With `EVERSTATE_PROFILE=redis` Redis serves the whole system; with `gcp` it is the
low-latency serving tier and cache in front of Spanner.
"""

from __future__ import annotations

import json
from typing import Any, Sequence

from everstate.domain import Event

from .client import Keys, shared_client
from .index import RedisVectorIndex, build_index
from .store import RedisMemoryStore, build_store


class RedisCache:
    def __init__(self, client: Any, keys: Keys) -> None:
        self._r, self._k = client, keys

    async def get(self, key: str) -> bytes | None:
        return await self._r.get(self._k.cache(key))

    async def set(self, key: str, value: bytes, *, ttl_seconds: int | None = None) -> None:
        await self._r.set(self._k.cache(key), value, ex=ttl_seconds)

    async def delete(self, *keys: str) -> int:
        return int(await self._r.delete(*[self._k.cache(k) for k in keys])) if keys else 0

    async def incr(self, key: str) -> int:
        return int(await self._r.incr(self._k.cache(key)))


class RedisEventLog:
    """Redis Streams, one capped stream per tenant (XADD MAXLEN ~ N)."""

    def __init__(self, client: Any, keys: Keys, maxlen: int) -> None:
        self._r, self._k, self._maxlen = client, keys, maxlen

    async def append(self, event: Event) -> None:
        await self._r.xadd(
            self._k.stream(event.tenant_id),
            {"e": json.dumps(event.to_dict(), separators=(",", ":"))},
            maxlen=self._maxlen,
            approximate=True,
        )

    async def read(self, tenant_id: str, *, kinds: Sequence[str] | None = None,
                   since_ts: float | None = None, limit: int = 1000) -> list[Event]:
        start = f"{int(since_ts * 1000)}" if since_ts else "-"
        kind_set = set(kinds) if kinds else None
        out: list[Event] = []
        cursor = start
        while len(out) < limit:
            batch = await self._r.xrange(self._k.stream(tenant_id), min=cursor, max="+", count=500)
            if not batch:
                break
            for stream_id, fields in batch:
                ev = Event.from_dict(json.loads(fields[b"e"]))
                if (kind_set is None or ev.kind in kind_set) and (since_ts is None or ev.ts > since_ts):
                    out.append(ev)
            last = batch[-1][0].decode()
            ms, _, seq = last.partition("-")
            cursor = f"{ms}-{int(seq) + 1}"
            if len(batch) < 500:
                break
        return out[-limit:]


def build_cache(settings: Any, ctx: Any) -> RedisCache:
    return RedisCache(shared_client(settings, ctx), Keys(settings.redis.key_prefix))


def build_events(settings: Any, ctx: Any) -> RedisEventLog:
    return RedisEventLog(shared_client(settings, ctx), Keys(settings.redis.key_prefix), settings.redis.stream_maxlen)


__all__ = ["RedisCache", "RedisEventLog", "RedisMemoryStore", "RedisVectorIndex",
           "build_cache", "build_events", "build_index", "build_store"]
