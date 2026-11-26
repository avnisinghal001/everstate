"""Core domain types. Pure Python: no I/O, no cloud SDKs.

Vocabulary
----------
Tenant      Hard isolation boundary (an organisation). Every operation is tenant-bound
            and the tenant always comes from the authenticated caller, never from input.
Scope       Where a memory applies inside a tenant: ORG > TEAM > AGENT > USER.
Memory      One durable unit of knowledge (a fact, preference, guardrail, procedure…)
            with provenance, confidence, lifecycle status and an embedding.
Proposal    A Memory in status PROPOSED: produced by consolidation, invisible to recall
            until a person or policy promotes it.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Mapping, Sequence

Vector = list[float]


class ScopeLevel(str, Enum):
    """Broadest to narrowest. SESSION is short-term working memory (TTL-bound)."""

    ORG = "org"
    TEAM = "team"
    AGENT = "agent"
    USER = "user"
    SESSION = "session"


class MemoryKind(str, Enum):
    FACT = "fact"              # declarative knowledge about the world or a subject
    PREFERENCE = "preference"  # how a subject likes things done
    GUARDRAIL = "guardrail"    # must / must-not rules; broader scopes win
    PROCEDURE = "procedure"    # reusable steps or playbook entries
    EPISODE = "episode"        # summarised past interaction


class MemoryStatus(str, Enum):
    PROPOSED = "proposed"      # quarantined: not recallable
    ACTIVE = "active"
    SUPERSEDED = "superseded"  # replaced by a newer memory (kept for audit)
    REJECTED = "rejected"


@dataclass(frozen=True, slots=True)
class Scope:
    level: ScopeLevel
    id: str

    @property
    def key(self) -> str:
        return f"{self.level.value}:{self.id}"

    @classmethod
    def parse(cls, raw: str) -> "Scope":
        level, _, ident = raw.partition(":")
        if not ident:
            raise ValueError(f"scope must look like 'level:id', got {raw!r}")
        return cls(ScopeLevel(level), ident)

    def __str__(self) -> str:  # pragma: no cover - convenience
        return self.key


@dataclass(frozen=True, slots=True)
class Provenance:
    """Where a memory came from. Required for trust, audit and deletion."""

    source: str                       # e.g. "api", "consolidation", "connector:gdrive"
    actor: str                        # authenticated principal that caused the write
    session_id: str | None = None
    event_ids: tuple[str, ...] = ()   # events the memory was derived from
    model_id: str | None = None       # LLM that produced it, if any

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "actor": self.actor,
            "session_id": self.session_id,
            "event_ids": list(self.event_ids),
            "model_id": self.model_id,
        }

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "Provenance":
        return cls(
            source=str(raw.get("source", "unknown")),
            actor=str(raw.get("actor", "unknown")),
            session_id=raw.get("session_id"),
            event_ids=tuple(raw.get("event_ids") or ()),
            model_id=raw.get("model_id"),
        )


def new_id(prefix: str = "mem") -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def content_hash(text: str) -> str:
    return hashlib.sha256(" ".join(text.lower().split()).encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class Memory:
    tenant_id: str
    scope: Scope
    kind: MemoryKind
    key: str                      # canonical slot, e.g. "favorite_language"; arbitration groups on it
    content: str                  # natural-language statement that gets embedded and shown
    provenance: Provenance
    id: str = field(default_factory=new_id)
    confidence: float = 1.0
    status: MemoryStatus = MemoryStatus.ACTIVE
    embedding: Vector | None = None
    embedding_model: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    supersedes: str | None = None
    version: int = 1
    expires_at: float | None = None   # set for SESSION-scope working memory

    @property
    def expired(self) -> bool:
        return self.expires_at is not None and self.expires_at <= time.time()

    @property
    def digest(self) -> str:
        return content_hash(f"{self.scope.key}|{self.kind.value}|{self.key}|{self.content}")

    def evolve(self, **changes: Any) -> "Memory":
        changes.setdefault("updated_at", time.time())
        return replace(self, **changes)

    def to_dict(self, *, include_embedding: bool = False) -> dict[str, Any]:
        data = {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "scope": self.scope.key,
            "kind": self.kind.value,
            "key": self.key,
            "content": self.content,
            "confidence": self.confidence,
            "status": self.status.value,
            "embedding_model": self.embedding_model,
            "metadata": dict(self.metadata),
            "provenance": self.provenance.to_dict(),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "supersedes": self.supersedes,
            "version": self.version,
            "expires_at": self.expires_at,
        }
        if include_embedding:
            data["embedding"] = list(self.embedding) if self.embedding is not None else None
        return data

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "Memory":
        return cls(
            id=str(raw["id"]),
            tenant_id=str(raw["tenant_id"]),
            scope=Scope.parse(str(raw["scope"])),
            kind=MemoryKind(raw["kind"]),
            key=str(raw["key"]),
            content=str(raw["content"]),
            confidence=float(raw.get("confidence", 1.0)),
            status=MemoryStatus(raw.get("status", MemoryStatus.ACTIVE.value)),
            embedding=list(raw["embedding"]) if raw.get("embedding") is not None else None,
            embedding_model=raw.get("embedding_model"),
            metadata=dict(raw.get("metadata") or {}),
            provenance=Provenance.from_dict(raw.get("provenance") or {}),
            created_at=float(raw.get("created_at", time.time())),
            updated_at=float(raw.get("updated_at", time.time())),
            supersedes=raw.get("supersedes"),
            version=int(raw.get("version", 1)),
            expires_at=float(raw["expires_at"]) if raw.get("expires_at") is not None else None,
        )


@dataclass(frozen=True, slots=True)
class Hit:
    """A raw vector-search result: id + similarity in [-1, 1] (cosine)."""

    memory_id: str
    similarity: float


@dataclass(frozen=True, slots=True)
class ScoredMemory:
    memory: Memory
    score: float
    similarity: float
    components: Mapping[str, float]


@dataclass(frozen=True, slots=True)
class Suppressed:
    memory: Memory
    winner_id: str
    reason: str


@dataclass(frozen=True, slots=True)
class RecallQuery:
    tenant_id: str
    text: str
    scopes: Sequence[Scope]
    k: int = 8
    kinds: Sequence[MemoryKind] | None = None
    min_similarity: float = 0.0


@dataclass(frozen=True, slots=True)
class RecallResult:
    query: RecallQuery
    memories: tuple[ScoredMemory, ...]
    suppressed: tuple[Suppressed, ...] = ()
    latency_ms: float = 0.0
    cache_hit: bool = False
    trace: Mapping[str, Any] = field(default_factory=dict)

    def context_block(self) -> str:
        """Render memories as a compact block to place in an LLM prompt."""
        if not self.memories:
            return ""
        lines = [f"- [{m.memory.kind.value}/{m.memory.scope.level.value}] {m.memory.content}" for m in self.memories]
        return "Relevant memory:\n" + "\n".join(lines)


@dataclass(frozen=True, slots=True)
class Event:
    """Append-only activity record (observations, recalls, feedback, deletions)."""

    tenant_id: str
    kind: str                       # "observation" | "recall" | "feedback" | "forget" | ...
    actor: str
    payload: Mapping[str, Any]
    scope: Scope | None = None
    session_id: str | None = None
    id: str = field(default_factory=lambda: new_id("evt"))
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "kind": self.kind,
            "actor": self.actor,
            "scope": self.scope.key if self.scope else None,
            "session_id": self.session_id,
            "payload": dict(self.payload),
            "ts": self.ts,
        }

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "Event":
        return cls(
            id=str(raw["id"]),
            tenant_id=str(raw["tenant_id"]),
            kind=str(raw["kind"]),
            actor=str(raw.get("actor", "unknown")),
            scope=Scope.parse(raw["scope"]) if raw.get("scope") else None,
            session_id=raw.get("session_id"),
            payload=dict(raw.get("payload") or {}),
            ts=float(raw.get("ts", time.time())),
        )


@dataclass(frozen=True, slots=True)
class DeletionReceipt:
    tenant_id: str
    memory_ids: tuple[str, ...]
    planes: Mapping[str, int]        # plane name -> items removed (store, index, cache, ...)
    ts: float = field(default_factory=time.time)
