"""Fixtures: every engine-level test runs against each available backend profile."""

from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio

from everstate import Everstate, Settings

REDIS_URL = os.environ.get("EVERSTATE_TEST_REDIS_URL", "redis://localhost:6379/15")


def _redis_available() -> bool:
    try:
        import redis

        return bool(redis.Redis.from_url(REDIS_URL, socket_connect_timeout=0.5).ping())
    except Exception:
        return False


REDIS_UP = _redis_available()


def make_settings(profile: str, **overrides) -> Settings:
    settings = Settings(profile=profile, **overrides)
    settings.redis.url = REDIS_URL
    settings.redis.key_prefix = f"test-{uuid.uuid4().hex[:8]}"   # isolate every test
    settings.embedding.dimensions = 256
    return settings


@pytest.fixture(params=["local", pytest.param("redis", marks=pytest.mark.redis)])
def profile(request) -> str:
    if request.param == "redis" and not REDIS_UP:
        pytest.skip(f"Redis not reachable at {REDIS_URL}")
    return request.param


@pytest_asyncio.fixture
async def es(profile):
    engine = Everstate.from_settings(make_settings(profile))
    async with engine:
        yield engine


TENANT = "acme"
OTHER = "globex"
ACTOR = "user:ada@acme.com"
