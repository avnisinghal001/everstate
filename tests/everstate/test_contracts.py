"""Every built-in adapter must pass the public contract kit (everstate.testing)."""

from __future__ import annotations

import uuid

import pytest

from everstate import Settings
from everstate.registry import BuildContext, registry
from everstate.testing import check_cache, check_events, check_index, check_store

from .conftest import REDIS_UP, REDIS_URL

pytestmark = pytest.mark.asyncio

BACKENDS = ["memory", pytest.param("redis", marks=[pytest.mark.redis, pytest.mark.skipif(not REDIS_UP, reason="no Redis")])]


def _settings() -> Settings:
    s = Settings(profile="local")
    s.redis.url, s.redis.key_prefix, s.embedding.dimensions = REDIS_URL, f"contract-{uuid.uuid4().hex[:6]}", 8
    return s


async def _run(port: str, name: str, check) -> None:
    ctx = BuildContext()
    try:
        await check(registry.build(port, name, _settings(), ctx))
    finally:
        await ctx.aclose()


@pytest.mark.parametrize("name", BACKENDS)
async def test_store_contract(name):
    await _run("store", name, check_store)


@pytest.mark.parametrize("name", BACKENDS)
async def test_index_contract(name):
    await _run("index", name, check_index)


@pytest.mark.parametrize("name", BACKENDS)
async def test_cache_contract(name):
    await _run("cache", name, check_cache)


@pytest.mark.parametrize("name", BACKENDS)
async def test_events_contract(name):
    await _run("events", name, check_events)


async def test_redis_query_engine_contract_when_available():
    """Memorystore for Valkey / Redis Stack path: runs only if the server exposes FT.*."""
    if not REDIS_UP:
        pytest.skip("no Redis")
    import redis

    modules = {m[b"name"].decode().lower() for m in redis.Redis.from_url(REDIS_URL).module_list()}
    if not modules & {"search", "ft", "valkey-search"}:
        pytest.skip("Redis server has no Query Engine (FT.*); Vector Sets path is covered above")
    s = _settings()
    s.redis.vector_backend = "query_engine"
    ctx = BuildContext()
    try:
        await check_index(registry.build("index", "redis", s, ctx))
    finally:
        await ctx.aclose()
