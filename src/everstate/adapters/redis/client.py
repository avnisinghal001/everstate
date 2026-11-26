"""Shared Redis/Valkey connection + key layout.

One pool per container build (see BuildContext.resource). Keys carry a `{tenant}` hash
tag so a tenant's keys co-locate on one shard in cluster mode (Memorystore for Redis
Cluster / Valkey cluster), keeping multi-key pipelines single-slot.
"""

from __future__ import annotations

import hashlib
from typing import Any

from everstate.domain import AdapterUnavailable

try:
    import redis.asyncio as aioredis
    from redis.asyncio.cluster import RedisCluster
except ImportError as exc:  # pragma: no cover - redis is a core dependency
    raise AdapterUnavailable("redis adapters need `pip install redis>=6`") from exc


def tenant_tag(tenant_id: str) -> str:
    """Opaque, punctuation-free tenant token (safe in keys and tag queries)."""
    return hashlib.sha1(tenant_id.encode()).hexdigest()[:16]


def scope_tag(scope_key: str) -> str:
    return hashlib.sha1(scope_key.encode()).hexdigest()[:16]


class Keys:
    def __init__(self, prefix: str) -> None:
        self.p = prefix

    def memory(self, tenant_id: str, memory_id: str) -> str:
        return f"{self.p}:m:{{{tenant_tag(tenant_id)}}}:{memory_id}"

    def memory_prefix(self) -> str:
        return f"{self.p}:m:"

    def timeline(self, tenant_id: str) -> str:
        return f"{self.p}:z:{{{tenant_tag(tenant_id)}}}"

    def by_key(self, tenant_id: str, key: str) -> str:
        return f"{self.p}:k:{{{tenant_tag(tenant_id)}}}:{key}"

    def vectorset(self, tenant_id: str) -> str:
        return f"{self.p}:vs:{{{tenant_tag(tenant_id)}}}"

    def stream(self, tenant_id: str) -> str:
        return f"{self.p}:ev:{{{tenant_tag(tenant_id)}}}"

    def cache(self, key: str) -> str:
        return f"{self.p}:c:{key}"

    def search_index(self) -> str:
        return f"{self.p}-mem-idx"


def connect(settings: Any) -> Any:
    rs = settings.redis
    common = dict(decode_responses=False, socket_timeout=rs.socket_timeout_seconds,
                  socket_connect_timeout=rs.socket_timeout_seconds, health_check_interval=30)
    if rs.cluster:
        return RedisCluster.from_url(rs.url, **common)
    return aioredis.Redis.from_url(rs.url, **common)


def shared_client(settings: Any, ctx: Any) -> Any:
    def build() -> Any:
        client = connect(settings)
        ctx.on_close(client.aclose)
        return client

    return ctx.resource("redis", build)
