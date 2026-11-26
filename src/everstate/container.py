"""Composition root: Settings -> Runtime.

The only place that decides *which* adapters run. Everything else depends on ports.

Serving composition
-------------------
serving=direct  store/index are used as configured.
serving=redis   Redis becomes the hot tier in front of a durable store:
                  store  = ReplicatedStore(primary=<configured store>, replica=RedisMemoryStore)
                  index  = Redis vector index (Query Engine or Vector Sets)
                The durable store stays the system of record; Redis serves reads.
Any non-"none" cache wraps the embedder with CachedEmbedder.
"""

from __future__ import annotations

from everstate.config import Settings
from everstate.registry import BuildContext, Registry, registry as default_registry
from everstate.runtime import Runtime
from everstate.serving import CachedEmbedder, ReplicatedStore


def build_runtime(settings: Settings | None = None, *, registry: Registry | None = None) -> Runtime:
    settings = settings or Settings.from_env()
    reg = registry or default_registry
    ctx = BuildContext()

    def make(port: str, name: str):  # noqa: ANN202
        return reg.build(port, name, settings, ctx)

    embedder = make("embedder", settings.embedder)
    cache = make("cache", settings.cache)
    if settings.cache != "none":
        embedder = CachedEmbedder(embedder, cache, settings.recall.embedding_cache_ttl_seconds)

    store = make("store", settings.store)
    index = make("index", settings.index)
    if settings.serving == "redis" and settings.store != "redis":
        store = ReplicatedStore(primary=store, replica=make("store", "redis"))
        index = make("index", "redis")

    return Runtime(
        settings=settings,
        embedder=embedder,
        llm=make("llm", settings.llm),
        store=store,
        index=index,
        cache=cache,
        events=make("events", settings.events),
        researcher=make("researcher", settings.researcher),
        ctx=ctx,
    )
