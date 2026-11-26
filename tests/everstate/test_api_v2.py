"""/api/v2 over the real FastAPI app (auth middleware + identity binding)."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("EVERSTATE_PROFILE", "local")


@pytest.fixture(scope="module")
def client():
    from src.ui_service import v2
    from src.ui_service.server import api

    v2._engine = None
    with TestClient(api) as c:
        yield c


def test_v2_remember_recall_and_governance(client):
    r = client.post("/api/v2/memories", json={"key": "lang", "content": "I prefer Rust for systems work.", "kind": "preference"})
    assert r.status_code == 200 and r.json()["requires_promotion"] is False
    mem = r.json()["memory"]
    assert mem["scope"].startswith("user:") and mem["tenant_id"] == mem["scope"].split("@")[-1]   # identity-bound

    shared = client.post("/api/v2/memories", json={"scope": "org", "key": "deploys", "kind": "guardrail",
                                                   "content": "Never deploy on Fridays."}).json()
    assert shared["requires_promotion"] is True and shared["memory"]["status"] == "proposed"
    denied = client.post("/api/v2/proposals/promote", json={"ids": [shared["memory"]["id"]]})
    assert denied.status_code == 403                                                          # admin gate

    rec = client.post("/api/v2/recall", json={"query": "Rust systems work"}).json()
    assert rec["memories"][0]["memory"]["key"] == "lang" and "stages_ms" in rec["trace"]
    assert all(m["memory"]["status"] == "active" for m in rec["memories"])


def test_v2_session_lifecycle(client):
    client.post("/api/v2/observe", json={"session_id": "s-api", "text": "My favorite language is Kotlin."})
    ended = client.post("/api/v2/sessions/s-api/end").json()
    assert ended["proposals"] and ended["proposals"][0]["status"] == "proposed"
    ids = [p["id"] for p in ended["proposals"]]
    assert client.post("/api/v2/proposals/promote", json={"ids": ids}).status_code == 200   # own user scope
    deleted = client.post("/api/v2/memories/delete", json={"ids": ids}).json()
    assert deleted["planes"]["store"] == len(ids)


def test_v2_health_describe(client):
    assert client.get("/api/v2/health").json()["ok"] is True
    d = client.get("/api/v2/describe").json()
    assert d["adapters"]["profile"] == "local" and len(d["pipelines"]) == 3
