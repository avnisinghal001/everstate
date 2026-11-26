"""Remember: candidate memories -> durable, indexed, cache-coherent memories.

    normalize → embed → reconcile → persist → index → emit → invalidate

reconcile implements supersession instead of overwrite: when an ACTIVE memory with the
same (scope, key) exists, an identical one is a no-op (dedupe) and a different one is
written as version n+1 with `supersedes` pointing at the old row, which becomes
SUPERSEDED (kept for audit and rollback). PROPOSED memories are persisted and embedded
but never indexed or allowed to supersede until promoted.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from everstate.domain import Event, Memory, MemoryStatus, ScopeLevel
from everstate.ports import EmbedTask, IndexEntry
from everstate.runtime import Runtime

from .core import Pipeline, StageState


@dataclass
class RememberState(StageState):
    rt: Runtime = None   # type: ignore[assignment]
    actor: str = ""
    incoming: list[Memory] = field(default_factory=list)
    written: list[Memory] = field(default_factory=list)       # new rows (result)
    superseded: list[Memory] = field(default_factory=list)    # old rows marked SUPERSEDED
    duplicates: list[Memory] = field(default_factory=list)    # existing rows returned instead


class Normalize:
    name = "normalize"

    async def __call__(self, s: RememberState) -> RememberState:
        ttl = s.rt.settings.recall.session_ttl_seconds
        out = []
        for m in s.incoming:
            content = " ".join(m.content.split())
            if not content:
                raise ValueError("memory content is empty")
            changes: dict = {"content": content, "confidence": min(1.0, max(0.0, m.confidence)), "key": m.key.strip()}
            if m.scope.level is ScopeLevel.SESSION and m.expires_at is None:
                changes["expires_at"] = time.time() + ttl
            out.append(m.evolve(**changes))
        s.incoming = out
        return s


class Embed:
    name = "embed"

    async def __call__(self, s: RememberState) -> RememberState:
        todo = [i for i, m in enumerate(s.incoming) if m.embedding is None]
        if todo:
            vectors = await s.rt.embedder.embed([s.incoming[i].content for i in todo], task=EmbedTask.DOCUMENT)
            for i, vec in zip(todo, vectors):
                s.incoming[i] = s.incoming[i].evolve(embedding=vec, embedding_model=s.rt.embedder.model_id)
        return s


class Reconcile:
    name = "reconcile"

    async def __call__(self, s: RememberState) -> RememberState:
        keep: list[Memory] = []
        for m in s.incoming:
            if m.status is not MemoryStatus.ACTIVE:
                keep.append(m)
                continue
            existing = await s.rt.store.find(m.tenant_id, scopes=[m.scope], statuses=[MemoryStatus.ACTIVE], key=m.key, limit=5)
            same = next((e for e in existing if e.digest == m.digest), None)
            if same is not None:
                s.duplicates.append(same)
                continue
            if existing:
                latest = existing[0]
                s.superseded += [e.evolve(status=MemoryStatus.SUPERSEDED) for e in existing]
                m = m.evolve(supersedes=latest.id, version=latest.version + 1)
            keep.append(m)
        s.incoming = keep
        return s


class Persist:
    name = "persist"

    async def __call__(self, s: RememberState) -> RememberState:
        await s.rt.store.put_many([*s.superseded, *s.incoming])
        s.written = list(s.incoming)
        return s


class Index:
    name = "index"

    async def __call__(self, s: RememberState) -> RememberState:
        if not s.rt.index.colocated:
            by_tenant: dict[str, list[IndexEntry]] = {}
            for m in s.written:
                if m.status is MemoryStatus.ACTIVE and m.embedding is not None:
                    by_tenant.setdefault(m.tenant_id, []).append(
                        IndexEntry(m.id, list(m.embedding), m.scope.key, m.kind.value, m.expires_at))
            for tenant, entries in by_tenant.items():
                await s.rt.index.upsert(tenant, entries)
            for m in s.superseded:
                await s.rt.index.delete(m.tenant_id, [m.id])
        return s


class Emit:
    name = "emit"

    async def __call__(self, s: RememberState) -> RememberState:
        for m in s.written:
            await s.rt.events.append(Event(
                tenant_id=m.tenant_id, kind="memory.written", actor=s.actor, scope=m.scope,
                session_id=m.provenance.session_id,
                payload={"memory_id": m.id, "key": m.key, "status": m.status.value, "supersedes": m.supersedes},
            ))
        return s


class Invalidate:
    name = "invalidate"

    async def __call__(self, s: RememberState) -> RememberState:
        for tenant in {m.tenant_id for m in [*s.written, *s.superseded]}:
            await s.rt.bump_generation(tenant)
        return s


def build_remember_pipeline() -> Pipeline[RememberState]:
    return Pipeline("remember", Normalize(), Embed(), Reconcile(), Persist(), Index(), Emit(), Invalidate())
