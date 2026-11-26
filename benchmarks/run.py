"""Everstate benchmark runner.

    python -m benchmarks.run                                   # quick: hashing embedder, local + redis
    python -m benchmarks.run --embedders hashing,ollama        # + real semantic model (EmbeddingGemma)
    python -m benchmarks.run --scale 1000,10000                # latency scaling per backend

Suites
  quality       recall@1, recall@5, MRR for 40 paraphrased questions hidden among distractors
  latency       remember throughput; recall p50/p95/p99 cold (cache off) and warm (cache hit)
  precedence    fraction of scope-conflict cases resolved to the expected scope
  consolidation grounding gate precision/recall on grounded vs fabricated candidates

Results: benchmarks/results/<timestamp>.json and benchmarks/results/latest.md, with pinned
embedding model ids, dimensions, backend engines, hardware and library versions.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import pathlib
import platform
import statistics
import time
import uuid
from typing import Any

from everstate import Everstate, MemoryKind, Scope, Settings, __version__
from everstate.ports import LLMRequest, LLMResponse

from .datasets import (CONSOLIDATION_CANDIDATES, CONSOLIDATION_LOG, ORG_TONE, PRECEDENCE, TARGETS, distractors)

RESULTS = pathlib.Path(__file__).parent / "results"
TENANT, ACTOR = "bench", "bench@everstate.dev"
USER, ORG, TEAM = Scope.parse("user:ada"), Scope.parse("org:bench"), Scope.parse("team:platform")


QUANT = "Q8"


def settings_for(backend: str, embedder: str, dims: int, redis_url: str) -> Settings:
    s = Settings(profile="redis" if backend == "redis" else "local", embedder=embedder,
                 cache="none" if backend == "local-nocache" else "")
    s.embedding.dimensions = dims
    s.redis.url = redis_url
    s.redis.vectorset_quant = QUANT
    s.redis.key_prefix = f"bench-{uuid.uuid4().hex[:6]}"
    return s


def pct(values: list[float], q: float) -> float:
    values = sorted(values)
    return round(values[min(len(values) - 1, int(q * len(values)))], 3)


async def load(es: Everstate, n_distractors: int) -> float:
    started = time.perf_counter()
    batch = [(k, kind, text) for k, kind, text, _ in TARGETS]
    batch += [(k, "fact", t) for k, t in distractors(n_distractors)]
    from everstate.domain import Memory, Provenance

    mems = [Memory(tenant_id=TENANT, scope=USER, kind=MemoryKind(kind), key=k, content=text,
                   provenance=Provenance("bench", ACTOR)) for k, kind, text in batch]
    for i in range(0, len(mems), 200):
        await es.remember_many(TENANT, ACTOR, mems[i:i + 200])
    return len(mems) / (time.perf_counter() - started)


async def quality(es: Everstate) -> dict[str, Any]:
    r1 = r5 = rr = 0.0
    misses = []
    for key, _, _, question in TARGETS:
        res = await es.recall(TENANT, question, scopes=[USER], k=5, use_cache=False)
        keys = [sm.memory.key for sm in res.memories]
        rank = keys.index(key) + 1 if key in keys else None
        r1 += rank == 1
        r5 += rank is not None
        rr += 1 / rank if rank else 0
        if rank != 1:
            misses.append({"key": key, "got": keys[:1]})
    n = len(TARGETS)
    return {"recall@1": round(r1 / n, 3), "recall@5": round(r5 / n, 3), "mrr": round(rr / n, 3), "n": n,
            "misses": misses[:10]}


async def latency(es: Everstate, rounds: int) -> dict[str, Any]:
    questions = [q for *_, q in TARGETS]
    cold, warm = [], []
    for i in range(rounds):
        q = questions[i % len(questions)]
        cold.append((await es.recall(TENANT, q, scopes=[USER], use_cache=False)).latency_ms)
        await es.recall(TENANT, q, scopes=[USER])                       # populate cache
        warm.append((await es.recall(TENANT, q, scopes=[USER])).latency_ms)
    inner = getattr(es.rt.embedder, "inner", es.rt.embedder)
    embed = []
    for i in range(min(rounds, 20)):
        t0 = time.perf_counter()
        await inner.embed([f"{questions[i % len(questions)]} #{uuid.uuid4().hex[:4]}"])
        embed.append((time.perf_counter() - t0) * 1000)
    return {"query_embed_ms": {"p50": pct(embed, .5), "p95": pct(embed, .95)},
            "recall_cold_ms": {"p50": pct(cold, .5), "p95": pct(cold, .95), "p99": pct(cold, .99)},
            "recall_warm_ms": {"p50": pct(warm, .5), "p95": pct(warm, .95), "p99": pct(warm, .99)}}


async def precedence(es: Everstate) -> dict[str, Any]:
    await es.remember(TENANT, ACTOR, scope=ORG, key="tone", kind=MemoryKind.PREFERENCE, content=ORG_TONE)
    correct = 0
    for key, g_scope, g_text, p_scope, p_text, query, expected in PRECEDENCE:
        if g_text:
            await es.remember(TENANT, ACTOR, scope=ORG if g_scope == "org" else TEAM, key=key,
                              kind=MemoryKind.GUARDRAIL, content=g_text)
        await es.remember(TENANT, ACTOR, scope=USER, key=key, kind=MemoryKind.PREFERENCE, content=p_text)
        res = await es.recall(TENANT, query, scopes=[ORG, TEAM, USER], use_cache=False)
        winner = next((sm.memory.scope.level.value for sm in res.memories if sm.memory.key == key), None)
        correct += winner == expected
    return {"accuracy": round(correct / len(PRECEDENCE), 3), "cases": len(PRECEDENCE)}


class _ScriptedLLM:
    model_id = "scripted-candidates"

    async def generate(self, request: LLMRequest) -> LLMResponse:
        return LLMResponse(text=json.dumps({"memories": CONSOLIDATION_CANDIDATES}), model_id=self.model_id)


async def consolidation(es: Everstate) -> dict[str, Any]:
    es.rt.llm = _ScriptedLLM()
    for line in CONSOLIDATION_LOG:
        await es.observe(TENANT, ACTOR, line, session_id="bench-session")
    state = await es.end_session(TENANT, ACTOR, "bench-session", target=Scope.parse("user:maya"))
    accepted = {p.key for p in state.proposals}
    should = {c["key"] for c in CONSOLIDATION_CANDIDATES if c["grounded"] and c["confidence"] >= 0.6}
    fabricated = {c["key"] for c in CONSOLIDATION_CANDIDATES if not c["grounded"]}
    tp = len(accepted & should)
    return {"precision": round(tp / len(accepted), 3) if accepted else 1.0,
            "recall": round(tp / len(should), 3) if should else 1.0,
            "fabricated_accepted": sorted(accepted & fabricated), "candidates": len(CONSOLIDATION_CANDIDATES)}


async def run_one(backend: str, embedder: str, dims: int, n_distractors: int, rounds: int, redis_url: str) -> dict[str, Any]:
    s = settings_for(backend, embedder, dims, redis_url)
    async with Everstate.from_settings(s) as es:
        throughput = await load(es, n_distractors)
        out: dict[str, Any] = {
            "backend": backend, "embedder": embedder, "embedding_model": es.rt.embedder.model_id,
            "dimensions": dims, "index_engine": getattr(es.rt.index, "engine", "exact-bruteforce"),
            "corpus": len(TARGETS) + n_distractors, "remember_per_s": round(throughput, 1),
            "quality": await quality(es), "latency": await latency(es, rounds),
        }
        out["precedence"] = await precedence(es)
        out["consolidation"] = await consolidation(es)
        return out


def markdown(report: dict[str, Any]) -> str:
    lines = [f"Run {report['timestamp']} · everstate {report['everstate']} · {report['machine']} · Redis vector quantization {report.get('redis_vectorset_quant')}", "",
             "Retrieve = vector search + hydrate + score + arbitrate, recall cache off, query embedding excluded (shown separately).", "",
             "| backend | embedder (model, dims) | corpus | recall@1 | recall@5 | MRR | query embed p50 (ms) | retrieve p50 / p95 (ms) | cached recall p50 (ms) | remember/s |",
             "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for r in report["runs"]:
        q, lat = r["quality"], r["latency"]
        lines.append(f"| {r['backend']} ({r['index_engine']}) | {r['embedding_model']}, {r['dimensions']} | {r['corpus']:,} | "
                     f"{q['recall@1']:.2f} | {q['recall@5']:.2f} | {q['mrr']:.2f} | {lat['query_embed_ms']['p50']} | "
                     f"{lat['recall_cold_ms']['p50']} / {lat['recall_cold_ms']['p95']} | {lat['recall_warm_ms']['p50']} | "
                     f"{r['remember_per_s']:,.0f} |")
    gov = report["runs"][0]
    lines += ["", f"Scope precedence accuracy: {gov['precedence']['accuracy']:.0%} ({gov['precedence']['cases']} cases) · "
              f"consolidation gate precision {gov['consolidation']['precision']:.0%}, recall {gov['consolidation']['recall']:.0%}, "
              f"fabricated accepted: {gov['consolidation']['fabricated_accepted'] or 'none'}"]
    if report.get("scaling"):
        lines += ["", "| backend | corpus | recall p50 cold (ms) | p95 (ms) |", "|---|---:|---:|---:|"]
        for s in report["scaling"]:
            lines.append(f"| {s['backend']} ({s['index_engine']}) | {s['corpus']:,} | {s['p50']} | {s['p95']} |")
    return "\n".join(lines) + "\n"


async def scaling(backends: list[str], sizes: list[int], dims: int, redis_url: str) -> list[dict[str, Any]]:
    rows = []
    for backend in backends:
        for n in sizes:
            s = settings_for(backend, "hashing", dims, redis_url)
            async with Everstate.from_settings(s) as es:
                await load(es, n)
                lat = await latency(es, 40)
                rows.append({"backend": backend, "corpus": n + len(TARGETS),
                             "index_engine": getattr(es.rt.index, "engine", "exact-bruteforce"),
                             "p50": lat["recall_cold_ms"]["p50"], "p95": lat["recall_cold_ms"]["p95"]})
                print(f"  scaling {backend:6s} n={n:>6}: p50 {rows[-1]['p50']} ms")
    return rows


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backends", default="local,redis")
    ap.add_argument("--embedders", default="hashing")
    ap.add_argument("--dims", type=int, default=768)
    ap.add_argument("--distractors", type=int, default=960)
    ap.add_argument("--rounds", type=int, default=80)
    ap.add_argument("--scale", default="", help="comma-separated corpus sizes for the scaling suite")
    ap.add_argument("--redis-url", default="redis://localhost:6379/14")
    ap.add_argument("--vectorset-quant", default="Q8", choices=["Q8", "NOQUANT", "BIN"])
    a = ap.parse_args()
    global QUANT
    QUANT = a.vectorset_quant

    runs = []
    for embedder in a.embedders.split(","):
        for backend in a.backends.split(","):
            print(f"▶ {backend} · {embedder}")
            runs.append(await run_one(backend, embedder, a.dims, a.distractors, a.rounds, a.redis_url))
            q = runs[-1]["quality"]
            print(f"  recall@1 {q['recall@1']:.2f}  recall@5 {q['recall@5']:.2f}  MRR {q['mrr']:.2f}  "
                  f"p50 {runs[-1]['latency']['recall_cold_ms']['p50']} ms")
    report = {
        "timestamp": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "everstate": __version__,
        "machine": f"{platform.system()} {platform.machine()} · Python {platform.python_version()}",
        "redis_vectorset_quant": QUANT,
        "runs": runs,
        "scaling": await scaling(a.backends.split(","), [int(x) for x in a.scale.split(",") if x], a.dims, a.redis_url)
        if a.scale else [],
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{report['timestamp'].replace(':', '')}.json").write_text(json.dumps(report, indent=2))
    (RESULTS / "latest.md").write_text(markdown(report))
    print("\n" + markdown(report))


if __name__ == "__main__":
    asyncio.run(main())
