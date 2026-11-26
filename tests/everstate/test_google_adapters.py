"""Google Cloud adapters, verified without credentials via fake SDK objects.

Live behaviour is covered by tests marked `live_gcp` (RUN_GCP_LIVE_TESTS=1)."""

from __future__ import annotations

import math
from types import SimpleNamespace

import pytest

from everstate import Settings
from everstate.adapters.google import spanner as sp
from everstate.adapters.google.vertex import GeminiLLM, VertexEmbedder
from everstate.adapters.memory import InMemoryStore, InMemoryVectorIndex
from everstate.container import build_runtime
from everstate.domain import Memory, MemoryKind, Provenance, Scope
from everstate.ports import EmbedTask, LLMRequest
from everstate.registry import Registry, registry as default_registry
from everstate.serving import ReplicatedStore



# ---------------------------------------------------------------- Spanner
def test_spanner_ddl_has_vector_column_index_and_ttl():
    stmts = sp.ddl("EverstateMemories", "EverstateMemoriesByEmbedding", 768)
    joined = "\n".join(stmts)
    assert "Embedding ARRAY<FLOAT32>(vector_length=>768)" in joined
    assert "CREATE VECTOR INDEX EverstateMemoriesByEmbedding" in joined and "distance_type = 'COSINE'" in joined
    assert "WHERE Embedding IS NOT NULL" in joined
    assert "ROW DELETION POLICY (OLDER_THAN(ExpiresAt, INTERVAL 0 DAY))" in joined
    assert "PRIMARY KEY (TenantId, MemoryId)" in joined


def test_spanner_ann_and_exact_queries():
    ann = sp.SpannerVectorIndex(None, "T", "TIdx", 768, "ann", 24)._sql(scoped=True, kinds=False)
    assert "T@{FORCE_INDEX=TIdx}" in ann
    assert ann.count('APPROX_COSINE_DISTANCE(Embedding, @q, options => JSON \'{"num_leaves_to_search": 24}\')') == 2
    assert "Embedding IS NOT NULL" in ann and "TenantId = @tenant" in ann and "ScopeKey IN UNNEST(@scopes)" in ann
    assert ann.rstrip().endswith("LIMIT @k")
    exact = sp.SpannerVectorIndex(None, "T", "TIdx", 768, "exact", 24)._sql(scoped=False, kinds=True)
    assert "COSINE_DISTANCE(Embedding, @q)" in exact and "FORCE_INDEX" not in exact and "Kind IN UNNEST(@kinds)" in exact


class _FakeBatch:
    def __init__(self, sink):
        self.sink = sink

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def insert_or_update(self, table, columns, values):
        self.sink.append((table, columns, values))


@pytest.mark.asyncio
async def test_spanner_store_writes_tenant_first_rows_with_vectors():
    sink: list = []
    db = SimpleNamespace(batch=lambda: _FakeBatch(sink))
    store = sp.SpannerMemoryStore(db, "EverstateMemories")
    m = Memory(tenant_id="acme", scope=Scope.parse("user:ada"), kind=MemoryKind.FACT, key="k", content="c",
               provenance=Provenance("api", "ada"), embedding=[0.1, 0.2])
    await store.put(m)
    table, columns, values = sink[0]
    row = dict(zip(columns, values[0]))
    assert table == "EverstateMemories" and columns[:2] == ("TenantId", "MemoryId")
    assert row["TenantId"] == "acme" and row["Embedding"] == [0.1, 0.2] and row["ScopeKey"] == "user:ada"


# ---------------------------------------------------------------- Vertex AI
class _FakeModels:
    def __init__(self):
        self.calls = []

    async def embed_content(self, model, contents, config):
        self.calls.append((model, list(contents), config))
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[3.0, 4.0]) for _ in contents])

    async def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        return SimpleNamespace(text='{"ok": true}', candidates=[SimpleNamespace(finish_reason="STOP")],
                               usage_metadata=SimpleNamespace(prompt_token_count=7, candidates_token_count=3))


def _fake_client():
    models = _FakeModels()
    return SimpleNamespace(aio=SimpleNamespace(models=models)), models


@pytest.mark.asyncio
async def test_vertex_embedder_respects_single_input_models_and_task_types():
    client, models = _fake_client()
    emb = VertexEmbedder(client, "gemini-embedding-001", 2, batch_size=64)
    vecs = await emb.embed(["a", "b", "c"], task=EmbedTask.QUERY)
    assert len(models.calls) == 3                                   # one input per request
    assert models.calls[0][2].task_type == "RETRIEVAL_QUERY" and models.calls[0][2].output_dimensionality == 2
    assert all(math.isclose(sum(x * x for x in v), 1.0) for v in vecs)  # renormalised

    client2, models2 = _fake_client()
    await VertexEmbedder(client2, "text-embedding-005", 2, batch_size=64).embed(["a", "b", "c"])
    assert len(models2.calls) == 1 and models2.calls[0][2].task_type == "RETRIEVAL_DOCUMENT"


@pytest.mark.asyncio
async def test_gemini_structured_output_config():
    client, models = _fake_client()
    llm = GeminiLLM(client, "gemini-3.8-flash", 0.2)
    resp = await llm.generate(LLMRequest.prompt("hi", system="be brief", json_schema={"type": "object"}))
    _, _, config = models.calls[0]
    assert config.response_mime_type == "application/json" and config.response_json_schema == {"type": "object"}
    assert config.system_instruction == "be brief"
    assert resp.usage == {"input_tokens": 7, "output_tokens": 3} and resp.model_id == "gemini-3.8-flash"


# ---------------------------------------------------------------- composition
def test_gcp_profile_composes_redis_serving_tier_over_durable_store():
    """gcp profile: durable primary (spanner) + Redis replica + Redis vector index + Redis cache."""
    reg = Registry()
    reg._entries.update(default_registry._entries)
    built: dict[str, object] = {}

    def fake(port, name, obj_factory):
        def factory(settings, ctx):
            built[f"{port}:{name}"] = obj = obj_factory(settings)
            return obj
        reg.register(port, name)(factory)

    fake("store", "spanner", lambda s: InMemoryStore())
    fake("index", "spanner", lambda s: InMemoryVectorIndex(s.embedding.dimensions))
    fake("store", "redis", lambda s: InMemoryStore())
    fake("index", "redis", lambda s: InMemoryVectorIndex(s.embedding.dimensions))
    fake("cache", "redis", lambda s: __import__("everstate.adapters.memory", fromlist=["x"]).InMemoryCache())
    fake("events", "bigquery", lambda s: __import__("everstate.adapters.memory", fromlist=["x"]).InMemoryEventLog())
    fake("embedder", "vertex", lambda s: __import__("everstate.adapters.local", fromlist=["x"]).HashingEmbedder(64))
    fake("llm", "gemini", lambda s: __import__("everstate.adapters.local", fromlist=["x"]).OfflineLLM())
    fake("researcher", "gemini_search", lambda s: __import__("everstate.adapters.local", fromlist=["x"]).NoResearcher())

    rt = build_runtime(Settings(profile="gcp"), registry=reg)
    assert isinstance(rt.store, ReplicatedStore)
    assert rt.store.primary is built["store:spanner"] and rt.store.replica is built["store:redis"]
    assert rt.index is built["index:redis"]
