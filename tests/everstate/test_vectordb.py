"""Qdrant and Pinecone adapters against in-process fakes of their REST APIs.

The fakes implement just the documented request/response shapes the adapters use
(cosine ranking, payload/metadata filters, namespaces). Live clusters are exercised when
EVERSTATE_TEST_QDRANT_URL or EVERSTATE_TEST_PINECONE_HOST + PINECONE_API_KEY are set.
"""

from __future__ import annotations

import json
import os
import re

import httpx
import pytest

from everstate.adapters.vectordb import PineconeVectorIndex, QdrantVectorIndex
from everstate.testing import check_index
from everstate.vectors import cosine

pytestmark = pytest.mark.asyncio


def _match(value, cond) -> bool:
    if "value" in cond:
        return value == cond["value"]
    if "any" in cond:
        return value in cond["any"]
    return True


class FakeQdrant:
    def __init__(self) -> None:
        self.collections: dict[str, dict[str, dict]] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path, body = request.url.path, json.loads(request.content or b"{}")
        m = re.match(r"/collections/([^/]+)(/.*)?$", path)
        col, rest = m.group(1), m.group(2) or ""
        if rest == "/exists":
            return httpx.Response(200, json={"result": {"exists": col in self.collections}})
        if rest == "" and request.method == "PUT":
            self.collections[col] = {}
            return httpx.Response(200, json={"result": True})
        if rest == "" and request.method == "GET":
            return httpx.Response(200 if col in self.collections else 404, json={"result": {}})
        points = self.collections[col]
        if rest == "/index":
            return httpx.Response(200, json={"result": {"status": "acknowledged"}})
        if rest == "/points" and request.method == "PUT":
            for p in body["points"]:
                points[p["id"]] = p
            return httpx.Response(200, json={"result": {"status": "completed"}})
        if rest == "/points/delete":
            for pid in body["points"]:
                points.pop(pid, None)
            return httpx.Response(200, json={"result": {"status": "completed"}})
        if rest == "/points/query":
            def ok(p):
                for c in body["filter"]["must"]:
                    v = p["payload"].get(c["key"])
                    if "range" in c and not v > c["range"]["gt"]:
                        return False
                    if "match" in c and not _match(v, c["match"]):
                        return False
                return True
            hits = sorted((p for p in points.values() if ok(p)), key=lambda p: -cosine(body["query"], p["vector"]))
            return httpx.Response(200, json={"result": {"points": [
                {"id": p["id"], "score": cosine(body["query"], p["vector"]), "payload": {"memory_id": p["payload"]["memory_id"]}}
                for p in hits[: body["limit"]]]}})
        return httpx.Response(404, json={"status": {"error": f"unhandled {path}"}})


class FakePinecone:
    def __init__(self, dimension: int) -> None:
        self.dim = dimension
        self.ns: dict[str, dict[str, dict]] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path, body = request.url.path, json.loads(request.content or b"{}")
        assert request.headers.get("Api-Key") == "test-key"
        if path == "/describe_index_stats":
            return httpx.Response(200, json={"dimension": self.dim, "namespaces": {}})
        bucket = self.ns.setdefault(body.get("namespace", ""), {})
        if path == "/vectors/upsert":
            for v in body["vectors"]:
                bucket[v["id"]] = v
            return httpx.Response(200, json={"upsertedCount": len(body["vectors"])})
        if path == "/vectors/delete":
            for i in body["ids"]:
                bucket.pop(i, None)
            return httpx.Response(200, json={})
        if path == "/query":
            f = body["filter"]

            def ok(v):
                md = v["metadata"]
                return (md["exp"] > f["exp"]["$gt"] and ("scope" not in f or md["scope"] in f["scope"]["$in"])
                        and ("kind" not in f or md["kind"] in f["kind"]["$in"]))
            hits = sorted((v for v in bucket.values() if ok(v)), key=lambda v: -cosine(body["vector"], v["values"]))
            return httpx.Response(200, json={"matches": [{"id": v["id"], "score": cosine(body["vector"], v["values"])}
                                                         for v in hits[: body["topK"]]]})
        return httpx.Response(404)


async def test_qdrant_adapter_passes_index_contract():
    fake = FakeQdrant()
    client = httpx.AsyncClient(base_url="http://qdrant", transport=httpx.MockTransport(fake))
    await check_index(QdrantVectorIndex(client, "everstate_memories", 8))
    assert "everstate_memories" in fake.collections


async def test_pinecone_adapter_passes_index_contract_and_uses_tenant_namespaces():
    fake = FakePinecone(8)
    client = httpx.AsyncClient(base_url="https://pc", headers={"Api-Key": "test-key"}, transport=httpx.MockTransport(fake))
    await check_index(PineconeVectorIndex(client, 8))
    assert len(fake.ns) >= 2   # contract writes two tenants -> two namespaces


@pytest.mark.skipif(not os.environ.get("EVERSTATE_TEST_QDRANT_URL"), reason="set EVERSTATE_TEST_QDRANT_URL")
async def test_qdrant_live():
    client = httpx.AsyncClient(base_url=os.environ["EVERSTATE_TEST_QDRANT_URL"])
    await check_index(QdrantVectorIndex(client, "everstate_contract", 8))


@pytest.mark.skipif(not (os.environ.get("EVERSTATE_TEST_PINECONE_HOST") and os.environ.get("PINECONE_API_KEY")),
                    reason="set EVERSTATE_TEST_PINECONE_HOST and PINECONE_API_KEY (an 8-d cosine index)")
async def test_pinecone_live():
    client = httpx.AsyncClient(base_url=os.environ["EVERSTATE_TEST_PINECONE_HOST"],
                               headers={"Api-Key": os.environ["PINECONE_API_KEY"], "X-Pinecone-API-Version": "2025-04"})
    await check_index(PineconeVectorIndex(client, 8))
