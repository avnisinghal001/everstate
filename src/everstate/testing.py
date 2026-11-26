"""Adapter contract kit: prove a custom adapter honours its port.

Every built-in adapter passes these checks (tests/everstate/test_contracts.py). Run them
against your own adapter before registering it:

    import asyncio
    from everstate.testing import check_store, check_index, check_cache, check_events

    asyncio.run(check_store(MyStore()))
    asyncio.run(check_index(MyIndex(dimensions=8)))

Each check raises AssertionError with a precise message on the first violation.
They use unique tenant ids, so they are safe to run against a shared dev backend.
"""

from __future__ import annotations

import time
import uuid

from everstate.domain import Event, Memory, MemoryKind, MemoryStatus, Provenance, Scope
from everstate.ports import Cache, EventLog, IndexEntry, MemoryStore, VectorIndex
from everstate.vectors import normalize


def _tenant() -> str:
    return f"contract-{uuid.uuid4().hex[:10]}"


def _memory(tenant: str, key: str, content: str, *, scope: str = "user:u1", status=MemoryStatus.ACTIVE,
            expires_at: float | None = None, updated_at: float | None = None) -> Memory:
    m = Memory(tenant_id=tenant, scope=Scope.parse(scope), kind=MemoryKind.FACT, key=key, content=content,
               provenance=Provenance("contract", "tester"), status=status, embedding=[0.1, 0.2, 0.3],
               expires_at=expires_at)
    return m.evolve(updated_at=updated_at) if updated_at else m


async def check_store(store: MemoryStore) -> None:
    """MemoryStore contract.

    1. put/get round-trips every field (embedding included) and preserves id order
    2. tenants are isolated for get_many, find and delete
    3. find filters by scope, status, kind and key, newest first, honours limit
    4. put with an existing id replaces the row (status changes are visible)
    5. expired rows (expires_at in the past) are never returned
    6. delete returns the number of rows that actually existed
    """
    t, other = _tenant(), _tenant()
    a = _memory(t, "k1", "alpha", updated_at=time.time() - 10)
    b = _memory(t, "k2", "beta", scope="org:o1")
    c = _memory(t, "k1", "gamma", status=MemoryStatus.PROPOSED)
    await store.put_many([a, b, c])
    await store.put(_memory(other, "k1", "foreign"))

    got = await store.get_many(t, [b.id, a.id])
    assert [m.id for m in got] == [b.id, a.id], "get_many must preserve requested id order"
    assert got[1].content == "alpha" and got[1].embedding is not None, "fields must round-trip"
    assert all(abs(x - y) < 1e-6 for x, y in zip(got[1].embedding, [0.1, 0.2, 0.3])), \
        "embedding must round-trip (float32 precision is fine)"
    assert got[1].scope == a.scope and got[1].provenance.actor == "tester"

    assert await store.get_many(other, [a.id]) == [], "tenant isolation violated on get_many"
    assert {m.id for m in await store.find(other)} .isdisjoint({a.id, b.id, c.id}), "tenant isolation violated on find"

    found = await store.find(t, key="k1", statuses=[MemoryStatus.ACTIVE])
    assert [m.id for m in found] == [a.id], "find must filter by key and status"
    assert [m.id for m in await store.find(t, scopes=[Scope.parse("org:o1")])] == [b.id], "find must filter by scope"
    newest = await store.find(t, limit=1)
    assert len(newest) == 1 and newest[0].id in {b.id, c.id}, "find must return newest first and honour limit"

    await store.put(a.evolve(status=MemoryStatus.SUPERSEDED))
    (a2,) = await store.get_many(t, [a.id])
    assert a2.status is MemoryStatus.SUPERSEDED, "put with existing id must replace the row"

    gone = _memory(t, "k3", "expired", expires_at=time.time() - 1)
    await store.put(gone)
    assert await store.get_many(t, [gone.id]) == [], "expired rows must not be returned"

    assert await store.delete(other, [a.id]) == 0, "tenant isolation violated on delete"
    assert await store.delete(t, [a.id, "missing-id"]) == 1, "delete must count only existing rows"
    assert await store.get_many(t, [a.id]) == []


async def check_index(index: VectorIndex) -> None:
    """VectorIndex contract (skipped parts for colocated indexes, which the store feeds).

    1. search returns hits sorted by similarity (cosine, in [-1, 1]) with the nearest first
    2. scope_keys and kinds filters are applied before ranking
    3. tenants are isolated
    4. delete removes vectors from results; upsert of an existing id replaces it
    5. entries with expires_at in the past are not returned
    """
    if index.colocated:
        return
    await index.ensure()
    d = index.dimensions
    t, other = _tenant(), _tenant()

    def vec(i: int) -> list[float]:
        v = [0.0] * d
        v[i % d] = 1.0
        v[(i + 1) % d] = 0.3
        return normalize(v)

    await index.upsert(t, [IndexEntry("a", vec(0), "user:u1", "fact"), IndexEntry("b", vec(2), "user:u1", "fact"),
                           IndexEntry("c", vec(0), "org:o1", "guardrail")])
    await index.upsert(other, [IndexEntry("z", vec(0), "user:u1", "fact")])

    hits = await index.search(t, vec(0), k=3)
    assert hits and hits[0].memory_id in {"a", "c"} and hits[0].similarity > 0.95, "nearest neighbour must rank first"
    assert all(h1.similarity >= h2.similarity for h1, h2 in zip(hits, hits[1:])), "hits must be sorted"
    assert "z" not in {h.memory_id for h in hits}, "tenant isolation violated on search"
    assert {h.memory_id for h in await index.search(t, vec(0), k=3, scope_keys=["org:o1"])} == {"c"}, "scope filter"
    assert {h.memory_id for h in await index.search(t, vec(0), k=3, kinds=["fact"])} <= {"a", "b"}, "kind filter"

    await index.upsert(t, [IndexEntry("a", vec(2), "user:u1", "fact")])
    top = await index.search(t, vec(2), k=1, scope_keys=["user:u1"])
    assert top and top[0].memory_id in {"a", "b"}, "upsert must replace the vector"

    await index.delete(t, ["a"])
    assert "a" not in {h.memory_id for h in await index.search(t, vec(2), k=5)}, "deleted vectors must not return"

    await index.upsert(t, [IndexEntry("old", vec(4), "user:u1", "fact", expires_at=time.time() - 1)])
    assert "old" not in {h.memory_id for h in await index.search(t, vec(4), k=5)}, "expired entries must not return"


async def check_cache(cache: Cache) -> None:
    """Cache contract: get/set/delete/incr with TTL; missing keys return None."""
    k = f"contract:{uuid.uuid4().hex}"
    assert await cache.get(k) is None
    await cache.set(k, b"v1")
    assert await cache.get(k) == b"v1"
    await cache.set(k, b"v2", ttl_seconds=60)
    assert await cache.get(k) == b"v2"
    assert await cache.delete(k) == 1 and await cache.get(k) is None
    assert await cache.incr(k + ":n") == 1 and await cache.incr(k + ":n") == 2


async def check_events(log: EventLog) -> None:
    """EventLog contract: append-only, tenant-isolated, filter by kind and since_ts, oldest first."""
    t, other = _tenant(), _tenant()
    e1 = Event(tenant_id=t, kind="observation", actor="a", payload={"text": "one"}, ts=time.time() - 5)
    e2 = Event(tenant_id=t, kind="recall", actor="a", payload={})
    e3 = Event(tenant_id=t, kind="observation", actor="a", payload={"text": "three"})
    for e in (e1, e2, e3):
        await log.append(e)
    await log.append(Event(tenant_id=other, kind="observation", actor="x", payload={}))
    obs = await log.read(t, kinds=["observation"])
    assert [e.id for e in obs] == [e1.id, e3.id], "read must filter by kind, oldest first"
    assert [e.id for e in await log.read(t, since_ts=e1.ts)] == [e2.id, e3.id], "since_ts is exclusive"
    assert all(e.tenant_id == t for e in await log.read(t)), "tenant isolation violated on read"
    assert obs[0].payload == {"text": "one"}, "payload must round-trip"
