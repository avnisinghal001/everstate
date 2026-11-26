# Adapters and custom layers

Everstate's engine never imports a database, cloud SDK or model client. It talks to seven
**ports** (Python `Protocol`s in [`src/everstate/ports`](../src/everstate/ports/__init__.py)).
Every backend is an **adapter** that implements one port. A **registry** maps
`(port, name)` to a factory, and **configuration** picks the name. Swapping Redis for
Spanner, or Ollama for Vertex AI, is a setting, not a code change.

```
            ┌────────────────────────── Everstate engine ──────────────────────────┐
 config ──▶ │ remember · recall · consolidate · promote · feedback · forget         │
            │        pipelines of stages (recall / remember / consolidate)          │
            └──┬─────────┬──────────┬─────────┬──────────┬──────────┬──────────┬──┘
           Embedder     LLM    MemoryStore VectorIndex   Cache    EventLog  Researcher   ← ports
               │         │          │          │          │          │          │
   hashing · ollama   offline   memory·redis  memory·redis  memory   memory    none
   vertex · openai*   gemini    spanner     spanner·firestore redis   redis     gemini_search
                      openai*   firestore   vertex_vector_search none  bigquery  (opt-in, billed)
                                sqlite†     qdrant · pinecone                                ← adapters
```
`*` = any OpenAI-compatible endpoint · `†` = worked example in `examples/`

## The ports and their contracts

| Port | Responsibility | Contract highlights (checked by `everstate.testing`) |
|---|---|---|
| `Embedder` | text → unit vectors; `model_id`, `dimensions` | `task=QUERY` vs `DOCUMENT`; deterministic for a given model |
| `LLM` | generate text or schema-constrained JSON | honour `json_schema`; report `model_id` and usage |
| `MemoryStore` | system of record | tenant-partitioned; `get_many` keeps id order; `find` filters scope/status/kind/key newest-first; replace on same id; never return expired rows; `delete` counts only existing rows |
| `VectorIndex` | nearest-neighbour search | cosine similarity in [-1, 1], best first; scope/kind filters applied **before** ranking; tenant isolation; deletes and expiries respected. `colocated=True` when vectors live in the store rows (Spanner, Firestore) |
| `Cache` | bytes KV with TTL + `incr` | missing → `None`; `incr` atomic per key |
| `EventLog` | append-only activity | tenant-isolated; filter by kind; `since_ts` exclusive; oldest first |
| `Researcher` | look things up outside memory | returns sourced `Finding`s only. The engine files them as *proposals* |

## Built-in adapters

| Port | Name | Backend | Notes |
|---|---|---|---|
| store | `memory` | in-process | tests, laptops |
| store | `redis` | Redis 8 / Memorystore | `{tenant}` hash tags, cluster-safe; session rows use `PEXPIREAT` |
| store | `spanner` | Cloud Spanner | `PRIMARY KEY (TenantId, MemoryId)`, TTL via row deletion policy ([DDL](../sql/everstate_spanner.sql)) |
| store | `firestore` | Firestore | `tenants/{t}/memories/{id}` (install the `firestore` extra) |
| index | `memory` | exact cosine scan | O(n), good to ~10⁴ |
| index | `redis` | Redis | `auto` picks the **Query Engine** (`FT.*`: Redis Stack, Memorystore for Valkey or Redis Cluster) or Redis 8 **Vector Sets** (`VADD`/`VSIM`) |
| index | `spanner` | Spanner ANN | `APPROX_COSINE_DISTANCE` + `FORCE_INDEX` (Enterprise), or exact `COSINE_DISTANCE` |
| index | `firestore` | Firestore `find_nearest` | ≤ 2,048 dims, needs a vector index |
| index | `vertex_vector_search` | Vertex AI Vector Search | namespace restricts for tenant/scope/kind |
| index | `qdrant` | Qdrant (REST) | one collection, payload filters, UUIDv5 point ids |
| index | `pinecone` | Pinecone (REST) | one namespace per tenant |
| embedder | `vertex` | Vertex AI | `gemini-embedding-001` (one input per request), `gemini-embedding-2`, `text-embedding-005` |
| embedder | `ollama` | local | `embeddinggemma` with its query/document prompts |
| embedder | `hashing` | none | deterministic lexical baseline (BLAKE2b, stable across processes) |
| embedder / llm | `openai_compatible` | any `/v1` endpoint | plain `httpx` |
| llm | `gemini` | Vertex AI | structured output via `response_json_schema` |
| llm | `offline` | rules | deterministic stand-in for tests |
| cache | `memory` / `redis` / `none` | | recall cache uses per-tenant generation counters |
| events | `memory` / `redis` / `bigquery` | | Redis Streams capped per tenant; BigQuery partitioned by day |
| researcher | `none` / `gemini_search` | | search grounding is billed, so it's opt-in |

## Writing your own adapter (four steps)

**1. Implement the port.** Async methods, tenant as the first argument, no engine imports
beyond `everstate.domain`, `everstate.ports` and `everstate.vectors`.

```python
from everstate.domain import Hit
from everstate.ports import IndexEntry

class MilvusIndex:
    colocated = False
    def __init__(self, client, dimensions: int):
        self.dimensions, self._c = dimensions, client
    async def ensure(self): ...
    async def upsert(self, tenant_id: str, entries: list[IndexEntry]): ...
    async def delete(self, tenant_id: str, ids: list[str]) -> int: ...
    async def search(self, tenant_id, vector, *, k, scope_keys=None, kinds=None) -> list[Hit]: ...
```

**2. Prove it with the contract kit.** The same checks every built-in adapter passes:

```python
from everstate.testing import check_index
await check_index(MilvusIndex(client, dimensions=8))
```

**3. Register a factory.** Factories receive `settings` and a `BuildContext`. Use
`ctx.resource(name, builder)` to share one client across ports, and `ctx.on_close` to
release it.

```python
from everstate.registry import registry

@registry.register("index", "milvus")
def build_milvus(settings, ctx):
    client = ctx.resource("milvus", lambda: make_client(settings))
    return MilvusIndex(client, settings.embedding.dimensions)
```

**4. Select it.** `EVERSTATE_INDEX=milvus` (or `Settings(index="milvus")`).

The complete worked example is [`examples/sqlite_store.py`](../examples/sqlite_store.py),
a durable `MemoryStore` on stdlib SQLite. Its test (`tests/everstate/test_extending.py`)
runs the contract kit and checks that data survives a restart.

## Custom pipeline layers

Behaviour lives in three pipelines of small stages:

```
remember     normalize → embed → reconcile → persist → index → emit → invalidate
recall       embed_query → vector_search → hydrate → score → arbitrate → top_k
consolidate  load_events → extract → ground → gate → dedupe → propose
```

A stage is any object with a `name` and `async __call__(state) -> state`. Pipelines are
immutable values with `insert_after`, `insert_before`, `replace` and `without`, so a
variant never mutates the default:

```python
from everstate import Everstate, build_runtime
from everstate.pipeline import build_recall_pipeline
from examples.mmr_rerank import MMRRerank

recall = build_recall_pipeline().replace("top_k", MMRRerank(lambda_=0.7))
es = Everstate(build_runtime(settings), recall=recall)
```

Every stage's wall time lands in `result.trace["stages_ms"]`, so a new layer's cost is
visible immediately. Place a stage where its assumptions hold. For example, MMR *is* a
top-k policy, so it replaces `top_k`; inserted before it, `top_k`'s score sort would undo
the diversity.

## Composition rules (`everstate/container.py`)

- `cache != none` wraps the embedder in `CachedEmbedder`, so a repeated query never pays
  for embedding twice.
- `serving=redis` over a non-Redis store builds
  `ReplicatedStore(primary=<durable>, replica=Redis)` plus a Redis vector index. Writes
  go durable-first, point reads are served from Redis with read-through backfill, and
  listings stay on the primary (the single source of truth). Rebuild a cold Redis tier
  with `await es.reindex(tenant)`.
