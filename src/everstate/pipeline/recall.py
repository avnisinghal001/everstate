"""Recall: query text -> ranked, scope-arbitrated memories.

    embed_query → vector_search → hydrate → score → arbitrate → top_k

Scoring (all components in [0, 1] except utility in [-0.5, 0.5]):

    score = w_s · sim + w_r · 2^(−age / half_life) + w_c · confidence + w_u · (E[utility] − ½)

where E[utility] = α / (α + β) is the Beta posterior mean of "this memory helped",
updated by feedback (α = 1 + helpful, β = 1 + unhelpful). Neutral prior adds 0.

Arbitration groups candidates sharing a canonical `key` and keeps one winner:
  guardrails      broader scope wins   ORG > TEAM > AGENT > USER > SESSION
  everything else narrower scope wins  SESSION > USER > AGENT > TEAM > ORG
A guardrail always beats a non-guardrail with the same key. Losers are returned as
`suppressed` with a reason, so the decision is auditable.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from everstate.domain import (
    Hit, Memory, MemoryKind, MemoryStatus, RecallQuery, ScopeLevel, ScoredMemory, Suppressed,
)
from everstate.ports import EmbedTask
from everstate.runtime import Runtime

from .core import Pipeline, StageState

BROAD_FIRST = [ScopeLevel.ORG, ScopeLevel.TEAM, ScopeLevel.AGENT, ScopeLevel.USER, ScopeLevel.SESSION]
NARROW_FIRST = list(reversed(BROAD_FIRST))


@dataclass
class RecallState(StageState):
    query: RecallQuery = None  # type: ignore[assignment]
    rt: Runtime = None         # type: ignore[assignment]
    vector: list[float] = field(default_factory=list)
    hits: list[Hit] = field(default_factory=list)
    memories: dict[str, Memory] = field(default_factory=dict)
    scored: list[ScoredMemory] = field(default_factory=list)
    suppressed: list[Suppressed] = field(default_factory=list)


def utility_mean(memory: Memory) -> float:
    u = memory.metadata.get("utility") or {}
    a, b = 1.0 + float(u.get("helpful", 0)), 1.0 + float(u.get("unhelpful", 0))
    return a / (a + b)


def precedence(memory: Memory) -> tuple[int, int]:
    """Sort key (lower = stronger) used by arbitration."""
    if memory.kind is MemoryKind.GUARDRAIL:
        return (0, BROAD_FIRST.index(memory.scope.level))
    return (1, NARROW_FIRST.index(memory.scope.level))


class EmbedQuery:
    name = "embed_query"

    async def __call__(self, s: RecallState) -> RecallState:
        (s.vector,) = await s.rt.embedder.embed([s.query.text], task=EmbedTask.QUERY)
        return s


class VectorSearch:
    name = "vector_search"

    async def __call__(self, s: RecallState) -> RecallState:
        q, cfg = s.query, s.rt.settings.recall
        s.hits = await s.rt.index.search(
            q.tenant_id, s.vector,
            k=max(q.k * cfg.candidate_multiplier, q.k),
            scope_keys=[sc.key for sc in q.scopes] or None,
            kinds=[k.value for k in q.kinds] if q.kinds else None,
        )
        return s


class Hydrate:
    name = "hydrate"

    async def __call__(self, s: RecallState) -> RecallState:
        ids = [h.memory_id for h in s.hits]
        rows = await s.rt.store.get_many(s.query.tenant_id, ids)
        allowed = {sc.key for sc in s.query.scopes}
        s.memories = {
            m.id: m for m in rows
            if m.status is MemoryStatus.ACTIVE and not m.expired and (not allowed or m.scope.key in allowed)
        }
        return s


class Score:
    name = "score"

    async def __call__(self, s: RecallState) -> RecallState:
        cfg, now = s.rt.settings.recall, time.time()
        floor = max(cfg.min_similarity, s.query.min_similarity)
        for hit in s.hits:
            m = s.memories.get(hit.memory_id)
            if m is None or hit.similarity < floor:
                continue
            age_days = max(0.0, now - m.updated_at) / 86400.0
            parts = {
                "similarity": hit.similarity,
                "recency": 0.5 ** (age_days / cfg.half_life_days),
                "confidence": m.confidence,
                "utility": utility_mean(m) - 0.5,
            }
            score = (cfg.w_similarity * parts["similarity"] + cfg.w_recency * parts["recency"]
                     + cfg.w_confidence * parts["confidence"] + cfg.w_utility * parts["utility"])
            s.scored.append(ScoredMemory(m, round(score, 6), hit.similarity, parts))
        return s


class Arbitrate:
    name = "arbitrate"

    async def __call__(self, s: RecallState) -> RecallState:
        groups: dict[str, list[ScoredMemory]] = {}
        for sm in s.scored:
            groups.setdefault(sm.memory.key, []).append(sm)
        kept: list[ScoredMemory] = []
        for members in groups.values():
            members.sort(key=lambda x: (precedence(x.memory), -x.score))
            winner, *losers = members
            kept.append(winner)
            for loser in losers:
                reason = (
                    "same scope, lower score"
                    if loser.memory.scope == winner.memory.scope
                    else f"{winner.memory.kind.value}@{winner.memory.scope.level.value} takes precedence"
                )
                s.suppressed.append(Suppressed(loser.memory, winner.memory.id, reason))
        s.scored = kept
        return s


class TopK:
    name = "top_k"

    async def __call__(self, s: RecallState) -> RecallState:
        s.scored.sort(key=lambda x: x.score, reverse=True)
        s.scored = s.scored[: s.query.k]
        return s


def build_recall_pipeline() -> Pipeline[RecallState]:
    return Pipeline("recall", EmbedQuery(), VectorSearch(), Hydrate(), Score(), Arbitrate(), TopK())


def explain(state: RecallState) -> dict[str, Any]:
    return {"stages_ms": dict(state.trace), "candidates": len(state.hits), "hydrated": len(state.memories)}
