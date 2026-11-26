"""In-process adapters: zero dependencies, deterministic, used by tests and the local profile.

Not durable and not shared across processes. Everything is tenant-partitioned exactly
like the production adapters so behaviour (and tests) carry over.
"""

from __future__ import annotations

import asyncio
import heapq
import time
from collections import OrderedDict, defaultdict
from typing import Any, Mapping, Sequence

from everstate.domain import Event, Hit, Memory, MemoryKind, MemoryStatus, Scope
from everstate.ports import IndexEntry
from everstate.vectors import check_dimensions, cosine


class InMemoryStore:
    def __init__(self) -> None:
        self._rows: dict[str, dict[str, Memory]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def put(self, memory: Memory) -> None:
        async with self._lock:
            self._rows[memory.tenant_id][memory.id] = memory

    async def put_many(self, memories: Sequence[Memory]) -> None:
        async with self._lock:
            for m in memories:
                self._rows[m.tenant_id][m.id] = m

    async def get_many(self, tenant_id: str, ids: Sequence[str]) -> list[Memory]:
        rows = self._rows.get(tenant_id, {})
        return [m for i in ids if (m := rows.get(i)) is not None and not m.expired]

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
        out = [
            m
            for m in self._rows.get(tenant_id, {}).values()
            if not m.expired
            and (scope_keys is None or m.scope.key in scope_keys)
            and (statuses is None or m.status in statuses)
            and (kinds is None or m.kind in kinds)
            and (key is None or m.key == key)
        ]
        out.sort(key=lambda m: m.updated_at, reverse=True)
        return out[:limit]

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        async with self._lock:
            rows = self._rows.get(tenant_id, {})
            return sum(1 for i in ids if rows.pop(i, None) is not None)

    async def health(self) -> Mapping[str, Any]:
        return {"ok": True, "backend": "memory", "tenants": len(self._rows)}


class InMemoryVectorIndex:
    """Exact (brute-force) cosine search. O(n) per query; fine up to ~10^5 vectors."""

    colocated = False

    def __init__(self, dimensions: int) -> None:
        self.dimensions = dimensions
        self._vectors: dict[str, dict[str, IndexEntry]] = defaultdict(dict)

    async def ensure(self) -> None:
        return None

    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None:
        for e in entries:
            check_dimensions(e.vector, self.dimensions)
            self._vectors[tenant_id][e.memory_id] = e

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        bucket = self._vectors.get(tenant_id, {})
        return sum(1 for i in ids if bucket.pop(i, None) is not None)

    async def search(
        self,
        tenant_id: str,
        vector: Sequence[float],
        *,
        k: int,
        scope_keys: Sequence[str] | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[Hit]:
        check_dimensions(vector, self.dimensions)
        scope_set = set(scope_keys) if scope_keys else None
        kind_set = set(kinds) if kinds else None
        now = time.time()
        scored = (
            (cosine(vector, e.vector), e.memory_id)
            for e in self._vectors.get(tenant_id, {}).values()
            if (scope_set is None or e.scope_key in scope_set) and (kind_set is None or e.kind in kind_set)
            and (e.expires_at is None or e.expires_at > now)
        )
        return [Hit(mid, sim) for sim, mid in heapq.nlargest(k, scored)]

    async def health(self) -> Mapping[str, Any]:
        return {"ok": True, "backend": "memory", "vectors": sum(len(v) for v in self._vectors.values())}


class InMemoryCache:
    """LRU + TTL cache."""

    def __init__(self, max_items: int = 50_000) -> None:
        self._data: OrderedDict[str, tuple[bytes, float | None]] = OrderedDict()
        self._max = max_items

    async def get(self, key: str) -> bytes | None:
        item = self._data.get(key)
        if item is None:
            return None
        value, expires = item
        if expires is not None and expires <= time.monotonic():
            self._data.pop(key, None)
            return None
        self._data.move_to_end(key)
        return value

    async def set(self, key: str, value: bytes, *, ttl_seconds: int | None = None) -> None:
        self._data[key] = (value, time.monotonic() + ttl_seconds if ttl_seconds else None)
        self._data.move_to_end(key)
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    async def delete(self, *keys: str) -> int:
        return sum(1 for k in keys if self._data.pop(k, None) is not None)

    async def incr(self, key: str) -> int:
        raw = await self.get(key)
        value = int(raw or b"0") + 1
        await self.set(key, str(value).encode())
        return value


class NullCache:
    """Disables caching while keeping the Cache contract."""

    async def get(self, key: str) -> bytes | None:
        return None

    async def set(self, key: str, value: bytes, *, ttl_seconds: int | None = None) -> None:
        return None

    async def delete(self, *keys: str) -> int:
        return 0

    async def incr(self, key: str) -> int:
        return 0


class InMemoryEventLog:
    def __init__(self, max_events: int = 100_000) -> None:
        self._events: dict[str, list[Event]] = defaultdict(list)
        self._max = max_events

    async def append(self, event: Event) -> None:
        bucket = self._events[event.tenant_id]
        bucket.append(event)
        if len(bucket) > self._max:
            del bucket[: len(bucket) - self._max]

    async def read(
        self,
        tenant_id: str,
        *,
        kinds: Sequence[str] | None = None,
        since_ts: float | None = None,
        limit: int = 1000,
    ) -> list[Event]:
        kind_set = set(kinds) if kinds else None
        out = [
            e
            for e in self._events.get(tenant_id, [])
            if (kind_set is None or e.kind in kind_set) and (since_ts is None or e.ts > since_ts)
        ]
        return out[-limit:]


# --------------------------------------------------------------------------- factories
def build_store(settings: Any, ctx: Any) -> InMemoryStore:
    return InMemoryStore()


def build_index(settings: Any, ctx: Any) -> InMemoryVectorIndex:
    return InMemoryVectorIndex(settings.embedding.dimensions)


def build_cache(settings: Any, ctx: Any) -> InMemoryCache:
    return InMemoryCache()


def build_null_cache(settings: Any, ctx: Any) -> NullCache:
    return NullCache()


def build_events(settings: Any, ctx: Any) -> InMemoryEventLog:
    return InMemoryEventLog()
