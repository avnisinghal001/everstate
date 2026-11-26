"""Ports: the only contracts the engine depends on.

Every backend (in-memory, Redis/Memorystore, Spanner, Firestore, BigQuery, Vertex AI,
OpenAI-compatible…) implements one or more of these Protocols. The engine and pipelines
never import a cloud SDK; swapping infrastructure is a configuration change.

All I/O methods are async. Adapters wrapping sync SDKs run them in a worker thread.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from everstate.domain import Event, Hit, Memory, MemoryKind, MemoryStatus, Scope, Vector


# --------------------------------------------------------------------------- lifecycle
@runtime_checkable
class Component(Protocol):
    """Optional lifecycle hooks. Adapters may implement any subset."""

    async def health(self) -> Mapping[str, Any]: ...
    async def aclose(self) -> None: ...


# --------------------------------------------------------------------------- embeddings
class EmbedTask(str, Enum):
    DOCUMENT = "document"   # text being stored
    QUERY = "query"         # text being searched for


@runtime_checkable
class Embedder(Protocol):
    model_id: str
    dimensions: int

    async def embed(self, texts: Sequence[str], *, task: EmbedTask = EmbedTask.DOCUMENT) -> list[Vector]: ...


# --------------------------------------------------------------------------- LLMs
@dataclass(frozen=True, slots=True)
class Message:
    role: str      # "system" | "user" | "assistant"
    content: str


@dataclass(frozen=True, slots=True)
class LLMRequest:
    messages: Sequence[Message]
    system: str | None = None
    temperature: float = 0.2
    max_output_tokens: int = 1024
    json_schema: Mapping[str, Any] | None = None   # ask for structured JSON output
    model: str | None = None                       # override the adapter default
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def prompt(cls, text: str, **kwargs: Any) -> "LLMRequest":
        return cls(messages=(Message("user", text),), **kwargs)


@dataclass(frozen=True, slots=True)
class LLMResponse:
    text: str
    model_id: str
    usage: Mapping[str, int] = field(default_factory=dict)
    finish_reason: str | None = None


@runtime_checkable
class LLM(Protocol):
    model_id: str

    async def generate(self, request: LLMRequest) -> LLMResponse: ...


# --------------------------------------------------------------------------- research
@dataclass(frozen=True, slots=True)
class Finding:
    """One sourced claim from outside the memory store."""

    claim: str
    source_url: str
    source_title: str = ""
    confidence: float = 0.6


@runtime_checkable
class Researcher(Protocol):
    """Looks things up outside memory (web, intranet, docs) when recall comes back empty.

    Findings are never written as ACTIVE memory: the engine turns them into PROPOSED
    memories with the source URL as provenance, subject to the normal promotion gate.
    """

    model_id: str

    async def research(self, question: str, *, max_findings: int = 5) -> list[Finding]: ...


# --------------------------------------------------------------------------- storage
@runtime_checkable
class MemoryStore(Protocol):
    """System of record for memories (tenant-partitioned)."""

    async def put(self, memory: Memory) -> None: ...
    async def put_many(self, memories: Sequence[Memory]) -> None: ...
    async def get_many(self, tenant_id: str, ids: Sequence[str]) -> list[Memory]: ...
    async def find(
        self,
        tenant_id: str,
        *,
        scopes: Sequence[Scope] | None = None,
        statuses: Sequence[MemoryStatus] | None = None,
        kinds: Sequence[MemoryKind] | None = None,
        key: str | None = None,
        limit: int = 100,
    ) -> list[Memory]: ...
    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int: ...


@dataclass(frozen=True, slots=True)
class IndexEntry:
    memory_id: str
    vector: Vector
    scope_key: str
    kind: str
    expires_at: float | None = None   # session working memory: drop from the index on expiry


@runtime_checkable
class VectorIndex(Protocol):
    """Approximate or exact nearest-neighbour search over memory embeddings.

    `colocated` is True when vectors live inside the MemoryStore rows (e.g. Spanner,
    Firestore), in which case `upsert`/`delete` are no-ops.
    """

    dimensions: int
    colocated: bool

    async def ensure(self) -> None: ...
    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None: ...
    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int: ...
    async def search(
        self,
        tenant_id: str,
        vector: Vector,
        *,
        k: int,
        scope_keys: Sequence[str] | None = None,
        kinds: Sequence[str] | None = None,
    ) -> list[Hit]: ...


# --------------------------------------------------------------------------- cache
@runtime_checkable
class Cache(Protocol):
    async def get(self, key: str) -> bytes | None: ...
    async def set(self, key: str, value: bytes, *, ttl_seconds: int | None = None) -> None: ...
    async def delete(self, *keys: str) -> int: ...
    async def incr(self, key: str) -> int: ...


# --------------------------------------------------------------------------- events
@runtime_checkable
class EventLog(Protocol):
    async def append(self, event: Event) -> None: ...
    async def read(
        self,
        tenant_id: str,
        *,
        kinds: Sequence[str] | None = None,
        since_ts: float | None = None,
        limit: int = 1000,
    ) -> list[Event]: ...


__all__ = [
    "Cache", "Component", "EmbedTask", "Embedder", "EventLog", "Finding", "IndexEntry", "LLM", "LLMRequest",
    "LLMResponse", "MemoryStore", "Message", "Researcher", "VectorIndex",
]
