"""Everstate: the public API.

    async with Everstate.from_env() as es:
        await es.remember(tenant, actor, scope=Scope.parse("user:ada"), key="favorite_language",
                          content="Ada's favorite language is Python.", kind=MemoryKind.PREFERENCE)
        result = await es.recall(tenant, "what language should I use?", scopes=es.scopes(user="ada"))
        prompt_context = result.context_block()

Lifecycle of knowledge
----------------------
observe()       append raw activity (chat turns, tool calls) to the event log
remember()      write a memory directly (API, connectors, explicit "remember this")
consolidate()   Dream cycle: events -> grounded, gated PROPOSED memories (quarantine)
promote()       a person/policy accepts proposals -> ACTIVE, superseding older versions
recall()        ranked, scope-arbitrated retrieval with an explanation trace
feedback()      outcome signal -> per-memory utility posterior that re-weights recall
forget()        delete from store, index and caches, with a receipt
end_session()   consolidate a session's activity, then let its working memory expire
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Mapping, Sequence

from everstate.config import Settings
from everstate.container import build_runtime
from everstate.domain import (
    DeletionReceipt, Event, Memory, MemoryKind, MemoryStatus, NotFound, Provenance, RecallQuery,
    RecallResult, Scope, ScopeLevel, ScoredMemory, Suppressed, TenantViolation,
)
from everstate.pipeline import (
    ConsolidationState, Pipeline, RecallState, RememberState, build_consolidation_pipeline,
    build_recall_pipeline, build_remember_pipeline,
)
from everstate.ports import IndexEntry
from everstate.runtime import Runtime, dumps


class Everstate:
    """Pass custom pipelines to adapt behaviour without forking the engine, e.g.

        recall = build_recall_pipeline().insert_after("score", MyReranker())
        es = Everstate(build_runtime(settings), recall=recall)
    """

    def __init__(self, runtime: Runtime, *, recall: Pipeline | None = None, remember: Pipeline | None = None,
                 consolidate: Pipeline | None = None) -> None:
        self.rt = runtime
        self._recall = recall or build_recall_pipeline()
        self._remember = remember or build_remember_pipeline()
        self._consolidate = consolidate or build_consolidation_pipeline()

    @property
    def pipelines(self) -> dict[str, Pipeline]:
        return {"recall": self._recall, "remember": self._remember, "consolidate": self._consolidate}

    # ------------------------------------------------------------------ construction
    @classmethod
    def from_settings(cls, settings: Settings) -> "Everstate":
        return cls(build_runtime(settings))

    @classmethod
    def from_env(cls) -> "Everstate":
        return cls(build_runtime(Settings.from_env()))

    async def __aenter__(self) -> "Everstate":
        await self.rt.index.ensure()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self.rt.aclose()

    async def health(self) -> Mapping[str, Any]:
        return await self.rt.health()

    def describe(self) -> dict[str, Any]:
        return {
            "adapters": self.rt.settings.describe(),
            "embedding": {"model": self.rt.embedder.model_id, "dimensions": self.rt.embedder.dimensions},
            "llm": self.rt.llm.model_id,
            "pipelines": [p.describe() for p in (self._remember, self._recall, self._consolidate)],
        }

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def scopes(*, org: str | None = None, team: str | None = None, agent: str | None = None,
               user: str | None = None, session: str | None = None) -> list[Scope]:
        pairs = [(ScopeLevel.ORG, org), (ScopeLevel.TEAM, team), (ScopeLevel.AGENT, agent),
                 (ScopeLevel.USER, user), (ScopeLevel.SESSION, session)]
        return [Scope(level, ident) for level, ident in pairs if ident]

    @staticmethod
    def _guard(tenant_id: str, memories: Sequence[Memory]) -> None:
        if any(m.tenant_id != tenant_id for m in memories):
            raise TenantViolation("memory belongs to a different tenant")

    # ------------------------------------------------------------------ write path
    async def remember(
        self,
        tenant_id: str,
        actor: str,
        *,
        scope: Scope,
        key: str,
        content: str,
        kind: MemoryKind = MemoryKind.FACT,
        confidence: float = 1.0,
        session_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
        source: str = "api",
        status: MemoryStatus = MemoryStatus.ACTIVE,
    ) -> Memory:
        memory = Memory(tenant_id=tenant_id, scope=scope, kind=kind, key=key, content=content, confidence=confidence,
                        provenance=Provenance(source=source, actor=actor, session_id=session_id),
                        metadata=dict(metadata or {}), status=status)
        (stored,) = await self.remember_many(tenant_id, actor, [memory])
        return stored

    async def remember_many(self, tenant_id: str, actor: str, memories: Sequence[Memory]) -> list[Memory]:
        self._guard(tenant_id, memories)
        state = await self._remember.run(RememberState(rt=self.rt, actor=actor, incoming=list(memories)))
        by_key = {(m.scope.key, m.key): m for m in [*state.written, *state.duplicates]}
        return [by_key.get((m.scope.key, m.key.strip()), m) for m in memories]

    async def observe(self, tenant_id: str, actor: str, text: str, *, session_id: str | None = None,
                      scope: Scope | None = None, **payload: Any) -> Event:
        event = Event(tenant_id=tenant_id, kind="observation", actor=actor, scope=scope, session_id=session_id,
                      payload={"text": text, **payload})
        await self.rt.events.append(event)
        return event

    # ------------------------------------------------------------------ read path
    async def recall(
        self,
        tenant_id: str,
        text: str,
        *,
        scopes: Sequence[Scope] = (),
        k: int | None = None,
        kinds: Sequence[MemoryKind] | None = None,
        min_similarity: float = 0.0,
        use_cache: bool = True,
    ) -> RecallResult:
        started = time.perf_counter()
        query = RecallQuery(tenant_id=tenant_id, text=text, scopes=tuple(scopes), k=k or self.rt.settings.recall.k,
                            kinds=tuple(kinds) if kinds else None, min_similarity=min_similarity)
        cache_key = await self._recall_cache_key(query) if use_cache else None
        if cache_key and (raw := await self.rt.cache.get(cache_key)):
            return self._from_cache(query, raw, started)

        state = await self._recall.run(RecallState(query=query, rt=self.rt))
        result = RecallResult(
            query=query, memories=tuple(state.scored), suppressed=tuple(state.suppressed),
            latency_ms=round((time.perf_counter() - started) * 1000, 3),
            trace={"stages_ms": dict(state.trace), "candidates": len(state.hits), "hydrated": len(state.memories)},
        )
        if cache_key:
            await self.rt.cache.set(cache_key, self._to_cache(result), ttl_seconds=self.rt.settings.recall.cache_ttl_seconds)
        await self.rt.events.append(Event(
            tenant_id=tenant_id, kind="recall", actor="system",
            payload={"query_sha": hashlib.sha256(text.encode()).hexdigest()[:16],
                     "memory_ids": [m.memory.id for m in result.memories], "latency_ms": result.latency_ms},
        ))
        return result

    async def _recall_cache_key(self, q: RecallQuery) -> str:
        gen = await self.rt.generation(q.tenant_id)
        sig = json.dumps([q.text, sorted(s.key for s in q.scopes), q.k, [k.value for k in q.kinds or []],
                          q.min_similarity, self.rt.embedder.model_id], separators=(",", ":"))
        return f"recall:{q.tenant_id}:{gen}:{hashlib.sha256(sig.encode()).hexdigest()}"

    @staticmethod
    def _to_cache(result: RecallResult) -> bytes:
        return dumps({
            "memories": [{"m": sm.memory.to_dict(), "score": sm.score, "sim": sm.similarity,
                          "parts": dict(sm.components)} for sm in result.memories],
            "suppressed": [{"m": s.memory.to_dict(), "winner": s.winner_id, "reason": s.reason}
                           for s in result.suppressed],
            "trace": dict(result.trace),
        })

    @staticmethod
    def _from_cache(query: RecallQuery, raw: bytes, started: float) -> RecallResult:
        data = json.loads(raw)
        return RecallResult(
            query=query,
            memories=tuple(ScoredMemory(Memory.from_dict(x["m"]), x["score"], x["sim"], x["parts"]) for x in data["memories"]),
            suppressed=tuple(Suppressed(Memory.from_dict(x["m"]), x["winner"], x["reason"]) for x in data["suppressed"]),
            latency_ms=round((time.perf_counter() - started) * 1000, 3),
            cache_hit=True,
            trace=data.get("trace", {}),
        )

    # ------------------------------------------------------------------ learning loop
    async def consolidate(self, tenant_id: str, actor: str, *, target: Scope, session_id: str | None = None,
                          since_ts: float | None = None, min_confidence: float = 0.6) -> ConsolidationState:
        state = await self._consolidate.run(ConsolidationState(
            rt=self.rt, tenant_id=tenant_id, actor=actor, target=target, session_id=session_id,
            since_ts=since_ts, min_confidence=min_confidence,
        ))
        if state.proposals:
            await self.remember_many(tenant_id, actor, state.proposals)
        await self.rt.events.append(Event(
            tenant_id=tenant_id, kind="consolidation", actor=actor, scope=target, session_id=session_id,
            payload={"events": len(state.events), "proposed": [p.id for p in state.proposals],
                     "rejected": len(state.rejected), "model_id": state.model_id},
        ))
        return state

    async def proposals(self, tenant_id: str, *, scopes: Sequence[Scope] | None = None, limit: int = 100) -> list[Memory]:
        return await self.rt.store.find(tenant_id, scopes=scopes, statuses=[MemoryStatus.PROPOSED], limit=limit)

    async def promote(self, tenant_id: str, actor: str, ids: Sequence[str]) -> list[Memory]:
        rows = await self.rt.store.get_many(tenant_id, ids)
        self._guard(tenant_id, rows)
        pending = [m for m in rows if m.status is MemoryStatus.PROPOSED]
        if len(pending) != len(ids):
            raise NotFound("some ids are not pending proposals")
        # Same ids re-enter the write path as ACTIVE: reconcile supersedes older versions,
        # persist overwrites the proposal row in place, index makes them recallable.
        promoted = [m.evolve(status=MemoryStatus.ACTIVE,
                             metadata={**m.metadata, "promoted_by": actor, "promoted_at": time.time()})
                    for m in pending]
        return await self.remember_many(tenant_id, actor, promoted)

    async def reject(self, tenant_id: str, actor: str, ids: Sequence[str], reason: str = "") -> int:
        rows = [m for m in await self.rt.store.get_many(tenant_id, ids) if m.status is MemoryStatus.PROPOSED]
        self._guard(tenant_id, rows)
        await self.rt.store.put_many([m.evolve(status=MemoryStatus.REJECTED,
                                               metadata={**m.metadata, "rejected_by": actor, "reason": reason})
                                      for m in rows])
        return len(rows)

    async def feedback(self, tenant_id: str, actor: str, memory_ids: Sequence[str], *, helpful: bool) -> list[Memory]:
        rows = await self.rt.store.get_many(tenant_id, memory_ids)
        self._guard(tenant_id, rows)
        updated = []
        for m in rows:
            u = dict(m.metadata.get("utility") or {})
            field = "helpful" if helpful else "unhelpful"
            u[field] = int(u.get(field, 0)) + 1
            updated.append(m.evolve(metadata={**m.metadata, "utility": u}, updated_at=m.updated_at))
        await self.rt.store.put_many(updated)
        await self.rt.bump_generation(tenant_id)
        await self.rt.events.append(Event(tenant_id=tenant_id, kind="feedback", actor=actor,
                                          payload={"memory_ids": list(memory_ids), "helpful": helpful}))
        return updated

    async def research(self, tenant_id: str, actor: str, question: str, *, target: Scope,
                       max_findings: int = 5) -> list[Memory]:
        """Look outside memory (e.g. Gemini + Google Search) and file sourced findings as PROPOSED
        memories for `target`. Web content is never recallable until someone promotes it."""
        findings = await self.rt.researcher.research(question, max_findings=max_findings)
        proposals = [
            Memory(tenant_id=tenant_id, scope=target, kind=MemoryKind.FACT,
                   key="research_" + hashlib.sha256(f.claim.lower().encode()).hexdigest()[:12],
                   content=f.claim, confidence=f.confidence, status=MemoryStatus.PROPOSED,
                   provenance=Provenance(source="research", actor=actor, model_id=self.rt.researcher.model_id),
                   metadata={"source_url": f.source_url, "source_title": f.source_title, "question": question})
            for f in findings
        ]
        stored = await self.remember_many(tenant_id, actor, proposals) if proposals else []
        await self.rt.events.append(Event(tenant_id=tenant_id, kind="research", actor=actor, scope=target,
                                          payload={"question": question, "proposed": [m.id for m in stored],
                                                   "sources": [f.source_url for f in findings]}))
        return stored

    async def recall_or_research(self, tenant_id: str, actor: str, text: str, *, scopes: Sequence[Scope],
                                 target: Scope, min_score: float = 0.35, k: int | None = None) -> tuple[RecallResult, list[Memory]]:
        """Recall first; only when nothing clears `min_score` go to research (findings come back as proposals)."""
        result = await self.recall(tenant_id, text, scopes=scopes, k=k)
        if result.memories and result.memories[0].score >= min_score:
            return result, []
        return result, await self.research(tenant_id, actor, text, target=target)

    # ------------------------------------------------------------------ sessions & deletion
    async def end_session(self, tenant_id: str, actor: str, session_id: str, *, target: Scope,
                          min_confidence: float = 0.6) -> ConsolidationState:
        """Consolidate a session's observations into proposals for `target` (e.g. the user)."""
        return await self.consolidate(tenant_id, actor, target=target, session_id=session_id,
                                      min_confidence=min_confidence)

    async def forget(self, tenant_id: str, actor: str, ids: Sequence[str]) -> DeletionReceipt:
        rows = await self.rt.store.get_many(tenant_id, ids)
        self._guard(tenant_id, rows)
        planes = {
            "index": await self.rt.index.delete(tenant_id, list(ids)),
            "store": await self.rt.store.delete(tenant_id, list(ids)),
        }
        await self.rt.bump_generation(tenant_id)
        planes["recall_cache"] = 1  # generation bump invalidates every cached recall for the tenant
        await self.rt.events.append(Event(tenant_id=tenant_id, kind="forget", actor=actor,
                                          payload={"memory_ids": list(ids)}))
        return DeletionReceipt(tenant_id, tuple(ids), planes)

    async def reindex(self, tenant_id: str, *, batch: int = 500) -> int:
        """Rebuild the vector index (e.g. warming a fresh Redis serving tier) from the store."""
        if self.rt.index.colocated:
            return 0
        rows = await self.rt.store.find(tenant_id, statuses=[MemoryStatus.ACTIVE], limit=100_000)
        entries = [IndexEntry(m.id, list(m.embedding), m.scope.key, m.kind.value, m.expires_at)
                   for m in rows if m.embedding is not None]
        for start in range(0, len(entries), batch):
            await self.rt.index.upsert(tenant_id, entries[start:start + batch])
        return len(entries)
