"""Adapter registry: (port, name) -> factory.

Factories are registered by dotted path so optional SDKs (redis, google-cloud-*, …) are
imported only when that adapter is actually selected. Third parties can register their
own adapters with the decorator:

    from everstate.registry import registry

    @registry.register("store", "dynamo")
    def build_dynamo_store(settings, ctx):
        return DynamoStore(...)
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from everstate.domain import AdapterUnavailable, ConfigurationError

Factory = Callable[["Settings", "BuildContext"], Any]  # noqa: F821 - forward refs for docs

PORTS = ("embedder", "llm", "store", "index", "cache", "events", "researcher")


@dataclass
class BuildContext:
    """Shared resources for one container build (connection pools, SDK clients…).

    Adapters that talk to the same backend share one client via `resource()`, so e.g. the
    Redis store, index, cache and event log all use a single connection pool.
    """

    _resources: dict[str, Any] = field(default_factory=dict)
    _closers: list[Callable[[], Awaitable[None]]] = field(default_factory=list)

    def resource(self, name: str, builder: Callable[[], Any]) -> Any:
        if name not in self._resources:
            self._resources[name] = builder()
        return self._resources[name]

    def on_close(self, closer: Callable[[], Awaitable[None]]) -> None:
        self._closers.append(closer)

    async def aclose(self) -> None:
        while self._closers:
            await self._closers.pop()()


class Registry:
    def __init__(self) -> None:
        self._entries: dict[tuple[str, str], Factory | str] = {}

    def register(self, port: str, name: str) -> Callable[[Factory], Factory]:
        self._check_port(port)

        def deco(fn: Factory) -> Factory:
            self._entries[(port, name)] = fn
            return fn

        return deco

    def lazy(self, port: str, name: str, target: str) -> None:
        """Register `package.module:function` without importing it yet."""
        self._check_port(port)
        self._entries[(port, name)] = target

    def names(self, port: str) -> list[str]:
        return sorted(n for (p, n) in self._entries if p == port)

    def build(self, port: str, name: str, settings: Any, ctx: BuildContext) -> Any:
        self._check_port(port)
        entry = self._entries.get((port, name))
        if entry is None:
            raise ConfigurationError(
                f"unknown {port} adapter {name!r}; available: {', '.join(self.names(port)) or 'none'}"
            )
        factory = self._resolve(entry) if isinstance(entry, str) else entry
        return factory(settings, ctx)

    @staticmethod
    def _resolve(target: str) -> Factory:
        module_name, _, attr = target.partition(":")
        try:
            module = importlib.import_module(module_name)
        except ImportError as exc:  # optional dependency missing
            raise AdapterUnavailable(f"cannot load {target}: {exc}") from exc
        return getattr(module, attr)

    @staticmethod
    def _check_port(port: str) -> None:
        if port not in PORTS:
            raise ConfigurationError(f"unknown port {port!r}; expected one of {PORTS}")


registry = Registry()

_A = "everstate.adapters"
for _port, _name, _target in [
    # in-process (tests, local dev, embedded use)
    ("store", "memory", f"{_A}.memory:build_store"),
    ("index", "memory", f"{_A}.memory:build_index"),
    ("cache", "memory", f"{_A}.memory:build_cache"),
    ("events", "memory", f"{_A}.memory:build_events"),
    ("cache", "none", f"{_A}.memory:build_null_cache"),
    ("embedder", "hashing", f"{_A}.local:build_hashing_embedder"),
    ("llm", "offline", f"{_A}.local:build_offline_llm"),
    ("researcher", "none", f"{_A}.local:build_no_researcher"),
    ("researcher", "gemini_search", f"{_A}.google.vertex:build_researcher"),
    # Local semantic simulator: EmbeddingGemma (Google's open embedding model) via Ollama
    ("embedder", "ollama", f"{_A}.ollama:build_embedder"),
    # Redis 8 / Memorystore for Redis Cluster / Memorystore for Valkey
    ("store", "redis", f"{_A}.redis:build_store"),
    ("index", "redis", f"{_A}.redis:build_index"),
    ("cache", "redis", f"{_A}.redis:build_cache"),
    ("events", "redis", f"{_A}.redis:build_events"),
    # Google Cloud
    ("embedder", "vertex", f"{_A}.google.vertex:build_embedder"),
    ("llm", "gemini", f"{_A}.google.vertex:build_llm"),
    ("store", "spanner", f"{_A}.google.spanner:build_store"),
    ("index", "spanner", f"{_A}.google.spanner:build_index"),
    ("store", "firestore", f"{_A}.google.firestore:build_store"),
    ("index", "firestore", f"{_A}.google.firestore:build_index"),
    ("index", "vertex_vector_search", f"{_A}.google.vector_search:build_index"),
    ("events", "bigquery", f"{_A}.google.bigquery:build_events"),
    # Managed vector databases (REST, no SDK)
    ("index", "qdrant", f"{_A}.vectordb:build_qdrant"),
    ("index", "pinecone", f"{_A}.vectordb:build_pinecone"),
    # Any OpenAI-compatible endpoint (incl. the local Codex-backed server)
    ("llm", "openai_compatible", f"{_A}.openai:build_llm"),
    ("embedder", "openai_compatible", f"{_A}.openai:build_embedder"),
]:
    registry.lazy(_port, _name, _target)
