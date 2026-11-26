"""/api/v2: the Everstate engine over HTTP.

Identity binding (never trust the body for who you are):
    tenant  = domain of the authenticated email      (hard isolation boundary)
    actor   = authenticated email
    user    = scope "user:<email>"                   (a caller can only touch their own)
    org     = scope "org:<tenant>"

Governance: writes to shared scopes (org/team/agent) are stored as PROPOSED and need an
admin (EVERSTATE_ADMINS) to promote. Personal and session writes are ACTIVE at once.
"""

from __future__ import annotations

import os
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from everstate import Everstate, MemoryKind, MemoryStatus, Scope, ScopeLevel
from everstate.domain import EverstateError, NotFound, TenantViolation

router = APIRouter(prefix="/api/v2", tags=["everstate"])
_engine: Everstate | None = None

SHARED = {ScopeLevel.ORG, ScopeLevel.TEAM, ScopeLevel.AGENT}


async def engine() -> Everstate:
    global _engine
    if _engine is None:
        _engine = Everstate.from_env()
        await _engine.rt.index.ensure()
    return _engine


class Caller(BaseModel):
    email: str
    tenant: str

    @property
    def user_scope(self) -> Scope:
        return Scope(ScopeLevel.USER, self.email)

    @property
    def org_scope(self) -> Scope:
        return Scope(ScopeLevel.ORG, self.tenant)

    @property
    def is_admin(self) -> bool:
        admins = {a.strip().lower() for a in os.environ.get("EVERSTATE_ADMINS", "").split(",") if a.strip()}
        return self.email.lower() in admins


def caller(request: Request) -> Caller:
    email = getattr(request.state, "user_email", None)
    if not email:
        raise HTTPException(401, "authentication required")
    return Caller(email=email, tenant=email.rsplit("@", 1)[-1].lower())


def resolve_scope(c: Caller, level: ScopeLevel, ident: str | None) -> Scope:
    if level is ScopeLevel.USER:
        return c.user_scope
    if level is ScopeLevel.ORG:
        return c.org_scope
    if not ident:
        raise HTTPException(422, f"scope_id is required for {level.value} scope")
    return Scope(level, ident)


def _err(exc: Exception) -> HTTPException:
    if isinstance(exc, TenantViolation):
        return HTTPException(403, str(exc))
    if isinstance(exc, NotFound):
        return HTTPException(404, str(exc))
    return HTTPException(400, str(exc))


# ---------------------------------------------------------------- schemas
class RememberBody(BaseModel):
    scope: Literal["org", "team", "agent", "user", "session"] = "user"
    scope_id: str | None = Field(None, description="team/agent/session id; ignored for org and user")
    key: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=4000)
    kind: MemoryKind = MemoryKind.FACT
    confidence: float = Field(1.0, ge=0, le=1)
    session_id: str | None = None


class RecallBody(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    k: int = Field(8, ge=1, le=50)
    team: str | None = None
    agent: str | None = None
    session_id: str | None = None
    kinds: list[MemoryKind] | None = None
    include_org: bool = True


class ObserveBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=20_000)
    session_id: str


class IdsBody(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=500)
    reason: str = ""


class FeedbackBody(BaseModel):
    memory_ids: list[str] = Field(..., min_length=1, max_length=50)
    helpful: bool


# ---------------------------------------------------------------- routes
@router.get("/health")
async def health() -> Any:
    return await (await engine()).health()


@router.get("/describe")
async def describe() -> Any:
    return (await engine()).describe()


@router.post("/memories")
async def remember(body: RememberBody, request: Request) -> Any:
    c, es = caller(request), await engine()
    scope = resolve_scope(c, ScopeLevel(body.scope), body.scope_id or body.session_id)
    status = MemoryStatus.PROPOSED if scope.level in SHARED else MemoryStatus.ACTIVE
    try:
        m = await es.remember(c.tenant, c.email, scope=scope, key=body.key, content=body.content, kind=body.kind,
                              confidence=body.confidence, session_id=body.session_id, status=status)
    except EverstateError as exc:
        raise _err(exc) from exc
    return {"memory": m.to_dict(), "requires_promotion": status is MemoryStatus.PROPOSED}


@router.post("/recall")
async def recall(body: RecallBody, request: Request) -> Any:
    c, es = caller(request), await engine()
    scopes = [c.user_scope] + ([c.org_scope] if body.include_org else [])
    scopes += es.scopes(team=body.team, agent=body.agent, session=body.session_id)
    r = await es.recall(c.tenant, body.query, scopes=scopes, k=body.k, kinds=body.kinds)
    return {
        "memories": [{"memory": sm.memory.to_dict(), "score": sm.score, "components": dict(sm.components)} for sm in r.memories],
        "suppressed": [{"memory_id": s.memory.id, "winner_id": s.winner_id, "reason": s.reason} for s in r.suppressed],
        "context": r.context_block(),
        "latency_ms": r.latency_ms,
        "cache_hit": r.cache_hit,
        "trace": dict(r.trace),
    }


@router.post("/observe")
async def observe(body: ObserveBody, request: Request) -> Any:
    c, es = caller(request), await engine()
    event = await es.observe(c.tenant, c.email, body.text, session_id=body.session_id, scope=c.user_scope)
    return {"event_id": event.id}


@router.post("/sessions/{session_id}/end")
async def end_session(session_id: str, request: Request) -> Any:
    c, es = caller(request), await engine()
    state = await es.end_session(c.tenant, c.email, session_id, target=c.user_scope)
    return {"proposals": [p.to_dict() for p in state.proposals], "rejected": state.rejected,
            "events": len(state.events), "model_id": state.model_id, "trace": dict(state.trace)}


@router.get("/proposals")
async def proposals(request: Request) -> Any:
    c, es = caller(request), await engine()
    rows = await es.proposals(c.tenant)
    visible = [m for m in rows if m.scope.level in SHARED or m.scope == c.user_scope]
    return {"proposals": [m.to_dict() for m in visible]}


async def _owned_or_admin(c: Caller, es: Everstate, ids: list[str]) -> None:
    rows = await es.rt.store.get_many(c.tenant, ids)
    if any(m.scope.level in SHARED for m in rows) and not c.is_admin:
        raise HTTPException(403, "promoting shared-scope memories requires an admin (EVERSTATE_ADMINS)")
    if any(m.scope.level is ScopeLevel.USER and m.scope != c.user_scope for m in rows):
        raise HTTPException(403, "cannot act on another user's memories")


@router.post("/proposals/promote")
async def promote(body: IdsBody, request: Request) -> Any:
    c, es = caller(request), await engine()
    await _owned_or_admin(c, es, body.ids)
    try:
        promoted = await es.promote(c.tenant, c.email, body.ids)
    except EverstateError as exc:
        raise _err(exc) from exc
    return {"promoted": [m.to_dict() for m in promoted]}


@router.post("/proposals/reject")
async def reject(body: IdsBody, request: Request) -> Any:
    c, es = caller(request), await engine()
    await _owned_or_admin(c, es, body.ids)
    return {"rejected": await es.reject(c.tenant, c.email, body.ids, body.reason)}


@router.post("/feedback")
async def feedback(body: FeedbackBody, request: Request) -> Any:
    c, es = caller(request), await engine()
    updated = await es.feedback(c.tenant, c.email, body.memory_ids, helpful=body.helpful)
    return {"updated": [m.id for m in updated]}


@router.post("/memories/delete")
async def forget(body: IdsBody, request: Request) -> Any:
    c, es = caller(request), await engine()
    await _owned_or_admin(c, es, body.ids)
    receipt = await es.forget(c.tenant, c.email, body.ids)
    return {"deleted": list(receipt.memory_ids), "planes": dict(receipt.planes)}


class ResearchBody(BaseModel):
    question: str = Field(..., min_length=3, max_length=1000)
    max_findings: int = Field(5, ge=1, le=10)


@router.post("/research")
async def research(body: ResearchBody, request: Request) -> Any:
    """Recall first; on a miss, research outside memory. Findings return as sourced proposals."""
    c, es = caller(request), await engine()
    result, proposals = await es.recall_or_research(c.tenant, c.email, body.question,
                                                    scopes=[c.user_scope, c.org_scope], target=c.user_scope)
    return {"answered_from_memory": bool(result.memories) and not proposals,
            "memories": [sm.memory.to_dict() for sm in result.memories],
            "proposals": [m.to_dict() for m in proposals], "researcher": es.rt.researcher.model_id}
