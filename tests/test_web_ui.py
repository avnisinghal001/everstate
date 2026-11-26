"""Contract tests for the Vite/React frontend and the APIs it consumes.

The old static UI is retired; these tests assert the SPA shell, the legacy URL
redirects, the auth bridge and the studio bootstrap contract that the new
workspaces depend on.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.common.auth import get_default_dev_email
from src.common.config import get_config
from src.ui_service.server import api

DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
INDEX = DIST / "index.html"

pytestmark = pytest.mark.skipif(
    not INDEX.exists(),
    reason="Run 'cd web && npm run build' before the web UI contract tests.",
)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(api)


def test_spa_routes_serve_the_vite_shell(client: TestClient) -> None:
    for path in ("/", "/login", "/studio", "/how-it-works", "/studio?s=optimize"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert 'id="root"' in response.text, path
        assert "/assets/" in response.text, path
        assert "text/html" in response.headers.get("content-type", "")


def test_spa_assets_are_served_with_javascript_mime(client: TestClient) -> None:
    index = client.get("/").text
    assert "assets/index-" in index
    asset_path = index.split('src="', 1)[1].split('"', 1)[0]
    response = client.get(asset_path)
    assert response.status_code == 200
    assert "javascript" in response.headers.get("content-type", "")


def test_legacy_urls_redirect_into_the_spa(client: TestClient) -> None:
    redirects = {
        "/index.html": "/",
        "/login.html": "/login",
        "/studio.html": "/studio",
        "/how-it-works.html": "/how-it-works",
    }
    for old, new in redirects.items():
        response = client.get(old, follow_redirects=False)
        assert response.status_code == 302, old
        assert response.headers["location"].endswith(new), old


def test_auth_bridge_and_dev_identity(client: TestClient) -> None:
    config = get_config()
    expected_email = get_default_dev_email(config.allowed_email_domains)

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == expected_email

    session = client.post("/api/auth/session", json={"idToken": "local-dev-login"})
    assert session.status_code == 200
    assert session.json()["email"] == expected_email

    logout = client.get("/logout", follow_redirects=False)
    assert logout.status_code == 302
    assert logout.headers["location"].endswith("/login")

    unauth = client.get("/api/studio/state", headers={"X-Test-Enforce-Auth": "true"})
    assert unauth.status_code == 401


def test_studio_bootstrap_contract(client: TestClient) -> None:
    response = client.get("/api/studio/state")
    assert response.status_code == 200
    data = response.json()
    for key in (
        "files",
        "tree",
        "staged_commits",
        "sessions",
        "entities",
        "categories",
        "ingest_services",
        "ingest_config",
        "extractors",
        "backend",
        "security_policies",
        "active_config",
    ):
        assert key in data, key
    assert isinstance(data["tree"], dict)


def test_studio_configuration_endpoints(client: TestClient) -> None:
    checks = {
        "/api/studio/categories": ("categories", list),
        "/api/studio/entities": ("entities", list),
        "/api/studio/extractors": ("extractors", list),
        "/api/studio/ingest/services": ("services", list),
        "/api/studio/security/policies": ("policies", list),
        "/api/studio/jobs?limit=5": ("jobs", list),
    }
    for path, (key, kind) in checks.items():
        response = client.get(path)
        assert response.status_code == 200, path
        assert isinstance(response.json().get(key), kind), path

    backend = client.get("/api/studio/backend/status")
    assert backend.status_code == 200
    assert isinstance(backend.json().get("subsystems"), list)

    sync = client.get("/api/studio/sync/status")
    assert sync.status_code == 200
    assert "staged_count" in sync.json()


def test_byot_ingest_and_logs(client: TestClient) -> None:
    user_id = "user:web-ui-test"
    session_id = "sess-web-ui-test"
    payload = (
        '{"role": "user", "content": "Always use uv run pytest."}\n'
        '{"role": "assistant", "content": "Understood."}\n'
    )
    ingest = client.post(
        "/api/telemetry/ingest_transcript",
        json={"user_id": user_id, "session_id": session_id, "raw_transcript": payload, "format": "jsonl"},
    )
    assert ingest.status_code == 200
    assert ingest.json()["status"] == "success"

    logs = client.get(f"/api/logs/{session_id}")
    assert logs.status_code == 200
    assert logs.json()["count"] >= 2


def test_built_index_references_only_local_assets() -> None:
    html = INDEX.read_text(encoding="utf-8")
    assert 'src="/assets/' in html
    assert 'href="/assets/' in html
    assert "http://localhost" not in html
