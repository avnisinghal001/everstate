# Changelog

## 1.0.0

First public release.

- **Engine:** ports-and-adapters memory engine: `remember`, `recall`, `observe`,
  `end_session`, `promote`, `feedback`, `forget`, with scope arbitration and grounded
  consolidation.
- **Adapters:** in-process, Redis 8 (Vector Sets / Query Engine), Ollama, Spanner,
  Vertex AI, BigQuery, Firestore, Qdrant, Pinecone, OpenAI-compatible.
- **API and console:** `/api/v2` with identity binding and governance; review-first
  console (Vite + React); MCP server.
- **Benchmarks:** reproducible runner with pinned model ids.
- **Infrastructure:** Dockerfile, docker-compose simulator, Terraform for Google Cloud.
- **Site:** isometric line-art landing page.
