"""The documented extension points work: custom adapters and custom pipeline stages."""

from __future__ import annotations

import pytest

from everstate import Everstate, MemoryKind, Scope, Settings, build_runtime
from everstate.pipeline import build_recall_pipeline
from everstate.testing import check_store

pytestmark = pytest.mark.asyncio


async def test_sqlite_example_store_passes_contract_and_plugs_in(tmp_path, monkeypatch):
    from examples.sqlite_store import SQLiteMemoryStore

    await check_store(SQLiteMemoryStore(":memory:"))

    monkeypatch.setenv("EVERSTATE_SQLITE_PATH", str(tmp_path / "es.db"))
    settings = Settings(profile="local", store="sqlite")
    settings.embedding.dimensions = 128
    async with Everstate.from_settings(settings) as es:
        await es.remember("t", "a", scope=Scope.parse("user:u"), key="k", content="Persisted in SQLite.")
    async with Everstate.from_settings(settings) as es2:   # new process-equivalent: data survived
        found = await es2.rt.store.find("t", key="k")
        assert found and found[0].content == "Persisted in SQLite."


async def test_custom_stage_inserted_into_recall_pipeline():
    from examples.mmr_rerank import MMRRerank

    recall = build_recall_pipeline().replace("top_k", MMRRerank(0.5))
    assert [s.name for s in recall.stages][-1] == "mmr_rerank"
    settings = Settings(profile="local")
    settings.embedding.dimensions = 128
    es = Everstate(build_runtime(settings), recall=recall)
    user = Scope.parse("user:u")
    for i, text in enumerate(["Deploy with Cloud Run.", "Deploy with Cloud Run please.", "Use Spanner for orders."]):
        await es.remember("t", "a", scope=user, key=f"k{i}", content=text, kind=MemoryKind.FACT)
    r = await es.recall("t", "deploy Cloud Run Spanner", scopes=[user], k=2)
    assert "mmr_rerank" in r.trace["stages_ms"]
    assert {sm.memory.key for sm in r.memories} >= {"k2"}   # diversity keeps the different memory
    await es.aclose()


def test_pipeline_edits_are_immutable():
    base = build_recall_pipeline()
    variant = base.without("arbitrate")
    assert "arbitrate" in [s.name for s in base.stages] and "arbitrate" not in [s.name for s in variant.stages]
    with pytest.raises(KeyError):
        base.replace("nope", base.stages[0])
