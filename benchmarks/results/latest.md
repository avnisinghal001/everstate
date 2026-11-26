Run 2026-11-24T14:33:42Z · everstate 0.1.0 · Darwin arm64 · Python 3.14.6 · Redis vector quantization Q8

Retrieve = vector search + hydrate + score + arbitrate, recall cache off, query embedding excluded (shown separately).

| backend | embedder (model, dims) | corpus | recall@1 | recall@5 | MRR | query embed p50 (ms) | retrieve p50 / p95 (ms) | cached recall p50 (ms) | remember/s |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| local (exact-bruteforce) | hashing-v1, 768 | 1,000 | 0.15 | 0.15 | 0.15 | 0.048 | 25.535 / 26.497 | 0.039 | 8,448 |
| redis (vectorset) | hashing-v1, 768 | 1,000 | 0.15 | 0.17 | 0.16 | 0.047 | 1.162 / 1.217 | 0.23 | 1,706 |
| local (exact-bruteforce) | embeddinggemma, 768 | 1,000 | 0.70 | 0.80 | 0.75 | 86.979 | 27.304 / 30.062 | 0.066 | 82 |
| redis (vectorset) | embeddinggemma, 768 | 1,000 | 0.70 | 0.80 | 0.75 | 83.44 | 1.317 / 1.477 | 0.312 | 92 |

Scope precedence accuracy: 100% (3 cases) · consolidation gate precision 100%, recall 100%, fabricated accepted: none

| backend | corpus | recall p50 cold (ms) | p95 (ms) |
|---|---:|---:|---:|
| local (exact-bruteforce) | 1,040 | 28.224 | 29.672 |
| local (exact-bruteforce) | 10,040 | 278.925 | 296.44 |
| redis (vectorset) | 1,040 | 1.402 | 1.795 |
| redis (vectorset) | 10,040 | 1.903 | 2.582 |
