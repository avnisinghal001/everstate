# AI Memory, Session and Context Infrastructure: 2025-2026 Competitive Landscape

Research date: 2026-11-24. Vendor claims are labelled as such. "Unverified" means I could not confirm the figure against a primary source. Search coverage was partial (about 25 tool calls); the Gaps subsections list what I could not close.

## 1. Supermemory, Mem0, Zep/Graphiti, Letta and other memory products

### Takeaway
Every major memory vendor is a retrieval or external-store layer over LLM calls. None of the products I checked updates model weights per user. Supermemory and Mem0 are the most aggressive on vendor-run benchmarks; Zep leads on temporal/bi-temporal graph design; Letta is the most explicit about asynchronous "sleep-time" memory editing, but that editing is still of external memory blocks.

### Cited Findings

**Supermemory**
- Research page lists these runs (vendor-run, no dates on most): LongMemEval-S 94.0% (vs. GPT-4o whole history 64.0%, Honcho 90.4%, Zep 71.2%); LoCoMo 93.0% with no baselines shown; BEAM 1M 0.689 (vs. Honcho 0.631); BEAM 100K 0.712; ATM-Bench ATM-RAG 0.768 (vs. A-Mem 0.461, Mem0 0.435). Source: [supermemory.ai/research](https://supermemory.ai/research)
- The same site lists a November 2026 cloud benchmark run (LongMemEval-S 94% with Claude Sonnet 5.5; 91.4% with a GPT model), a May 2026 SMFS release (3x fewer tokens on Claude, 1.75x on Codex), and a "learner-1" continual-learning model in 2026 with no numbers shown. Source: [supermemory.ai/research](https://supermemory.ai/research)
- Research page headlines a "1,250x less context sent to the model" claim with no baseline or paper link. Source: [supermemory.ai/research](https://supermemory.ai/research)
- A search summary reports a May 2026 Supermemory report claiming 97% overall Recall@20 on LongMemEval-S (a retrieval metric, not answer accuracy), which conflicts with the 94.0% answer-accuracy headline on the research page. I did not open the primary report to reconcile. Source: [supermemory.ai/research.md](https://supermemory.ai/research.md) (search result only)
- Open harness: MemoryBench on GitHub. Source: [github.com/supermemoryai/memorybench](https://github.com/supermemoryai/memorybench) (search result; not fetched)
- Connectors: Google Drive, Notion, OneDrive (real-time via webhooks plus scheduled sync every 4 hours, per docs summary). Gmail requires the Max plan ($100/mo) or higher; S3 and web crawler require Scale ($399/mo). Claude Code, Cursor and Hermes are named as plugins. Slack and GitHub are not listed as connectors on the pricing page. Sources: [supermemory.ai/pricing](https://supermemory.ai/pricing); [supermemory.ai/docs/connectors/overview](https://supermemory.ai/docs/connectors/overview) (search result)
- Supermemory's docs describe scoped sync for Google Drive and access via OAuth read-only scope. I found no page describing ACL/permission mirroring from source systems into the index. Sources: [supermemory.ai/docs/connectors/google-drive](https://supermemory.ai/docs/connectors/google-drive) (search result); [supermemory.ai/changelog/choose-what-google-drive-syncs.md](https://supermemory.ai/changelog/choose-what-google-drive-syncs.md) (title only)
- Pricing (credits): Free $0 ($5 credits); Pro $19/mo ($20); Max $100/mo ($130); Scale $399/mo ($600); Enterprise custom with "unlimited usage." Metered list rates: memory $0.005 per 1K tokens (plain) or $0.010 (rich); SuperRAG text $0.001 and rich $0.002 per 1K tokens; search $0.005 per 1K queries; operations $0.10 per 1K. Storage not priced. Compliance: SOC 2 and HIPAA listed on all plans per the pricing page; SSO Enterprise only; self-hosted local binary free up to 10,000 documents (not open source); own-cloud/dedicated on Scale and Enterprise; air-gapped Enterprise only. Source: [supermemory.ai/pricing](https://supermemory.ai/pricing)

**Mem0**
- Paper: arXiv 2504.19413 (submitted 28 Apr 2025), Mem0 and graph variant Mem0g on LoCoMo; claims 26% relative improvement in LLM-as-judge over OpenAI memory, >90% token savings and 91% lower p95 latency. Source: [arxiv.org/abs/2504.19413](https://arxiv.org/abs/2504.19413)
- Per a third-party table claiming to use the paper's protocol (not verified against the PDF): Mem0 66.9, Mem0g 68.4, Zep 66.0, OpenAI 52.9, full-context 72.9 on LoCoMo. If correct, full context beat Mem0 on accuracy at much higher token cost. Source: [huggingface.co/datasets/rovemark/locomo-benchmark-results](https://huggingface.co/datasets/rovemark/locomo-benchmark-results) (search result; unverified)
- Mem0's Nov 23, 2026 "State of AI Agent Memory 2026" post (vendor-authored) reports an April 2026 token-efficient algorithm at LoCoMo 92.5 (6,956 tokens/query) and LongMemEval 94.4 (6,787 tokens/query); BEAM 1M 64.1; BEAM 10M 48.6. The same post carries Zep at 80.32% (@189 ms; "up to 83%" config-dependent), Letta 74.0 (gpt-4o-mini, filesystem store), and OpenAI Memory 52.9. The author flags the OpenAI 52.9 and LongMemEval figures for other systems as unconfirmed "carried over" numbers. Source: [mem0.ai/blog/ai-agent-memory-benchmark](https://mem0.ai/blog/ai-agent-memory-benchmark)
- Pricing: Free: unlimited end users, 10,000 adds and 1,000 retrievals/month with Mem0 model calls, or 50,000 adds and 10,000 retrievals with your own LLM key; usage-based overage with a cap you set. Custom (contact sales) adds graph memory (entity linking), user profiles, "Dream" memory consolidation, SSO, audit logs, SLA, on-prem. Per-op overage rates and SOC 2/HIPAA/BYOK are not stated on the page. Source: [mem0.ai/pricing](https://mem0.ai/pricing) (published Nov 23, 2026 per page)

**Zep and Graphiti**
- Zep paper arXiv 2501.13956 (Jan 2025): bi-temporal knowledge graph (event time T vs. ingestion time T'); DMR 94.8% vs MemGPT 93.4%; LongMemEval accuracy up to +18.5% with 90% latency reduction. Source: [arxiv.org/html/2501.13956](https://arxiv.org/html/2501.13956); [blog.getzep.com/zep-a-temporal-knowledge-graph-architecture-for-agent-memory](https://blog.getzep.com/zep-a-temporal-knowledge-graph-architecture-for-agent-memory) (search result)
- Zep's launch-post table (GPT-4o): Zep 71.2% vs full-context 60.2% on LongMemEval; gpt-4o-mini: 63.8% vs 55.4%. The post notes gpt-4o-mini built the graph inside the service. Source: [blog.getzep.com/state-of-the-art-agent-memory](https://blog.getzep.com/state-of-the-art-agent-memory/) (search result; table partially garbled in extract)
- Graphiti is the open-source temporal KG engine behind Zep. Source: [blog.getzep.com/zep-a-temporal-knowledge-graph-architecture-for-agent-memory](https://blog.getzep.com/zep-a-temporal-knowledge-graph-architecture-for-agent-memory) (search result)
- Zep publicly disputes Mem0's SOTA claim, arguing Zep outperforms Mem0 by about 10% when implemented correctly. Source: [getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory](https://www.getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) (URL from search and redirect; article not fetched)
- Pricing is credits per "Episode": 1 credit per 350 bytes; retrieval, storage, users and threads are 0 credits. Flex $125/mo (50,000 credits; overage $25 per 10,000); Flex Plus $375/mo (200,000 credits; overage $75 per 40,000); Enterprise custom with SSO/SCIM, BYOC, BYOK, SOC 2 Type II and HIPAA BAA (confirm with sales). Free: 10,000 credits/month. Source: [getzep.com/pricing](https://www.getzep.com/pricing)

**Letta (MemGPT lineage)**
- Sleep-time compute (Apr 21, 2025): a primary agent plus a sleep-time agent that edits both its own memory and the primary's memory blocks asynchronously. The blog gives no accuracy or token-reduction numbers; it cites math benchmarks (AIME/GSM) and a "Pareto improvement." Source: [letta.com/blog/sleep-time-compute](https://letta.com/blog/sleep-time-compute)
- Paper: arXiv 2504.13171 (cited in the research brief; not fetched). Source: [arxiv.org/abs/2504.13171](https://arxiv.org/abs/2504.13171) (URL from brief, unverified)
- Cost note from Letta: higher sleep-time frequency means more tokens. Source: [letta.com/blog/sleep-time-compute](https://letta.com/blog/sleep-time-compute)
- Third-party summary reports about 1/5 the tokens at equal accuracy with sleep-time compute, from an Arize write-up. Source: [arize.com/blog/sleep-time-compute-beyond-inference-scaling-at-test-time/](https://arize.com/blog/sleep-time-compute-beyond-inference-scaling-at-test-time/) (search result; unverified)
- Letta Cloud pricing not found.

**Cognee**
- Apache 2.0. cognee 1.0 shipped a memory-native API (remember, recall, improve, forget) on June 26, 2026. €7.5M seed round, Feb 2026. GitHub stars reported at about 26k (mid-2026) and about 33k (Nov 2026) by secondary sites; unverified. Sources: [cognee.ai/blog/cognee-news/cognee-1-0-announcement](https://www.cognee.ai/blog/cognee-news/cognee-1-0-announcement) (search result); [dealroom.co/news/125999-cognee-raises-7-5m-to-build-memory-layer-for-ai-agents/](https://dealroom.co/news/125999-cognee-raises-7-5m-to-build-memory-layer-for-ai-agents/) (search result); [github.com/topoteretes/cognee](https://github.com/topoteretes/cognee) (repo README link from search)

**MemOS**
- A third-party comparison lists about 11k stars, unverified. Only a 339-star plugin repo (MemOS-Cloud-OpenClaw-Plugin) surfaced; I found no license for the core project and did not verify a repo URL for it. Source: search results only (no primary page read).

### Inferences
- The strongest, most consistent vendor claim pattern is "beats full-context at fewer tokens" on LoCoMo/LongMemEval, not absolute accuracy. Numbers are not comparable across vendors because each uses a different answer model, judge, top-k and dataset revision (as Mem0's own post concedes).
- Supermemory and Mem0 publish the most numbers; Zep publishes the most explicit temporal design and per-credit pricing; Letta publishes the least quantified results.

### Gaps
- Mem0's 2025 paper PDF was not read directly; the 66.9/68.4/66.0/52.9/72.9 table is from a secondary dataset.
- MemOS license and real star count not confirmed.
- Letta Cloud pricing and OpenMemory details not found.
- Benchmark-table reconciliation between Zep's own 80.32% and the 66.0% in the Mem0 paper's table not resolved.

## 2. First-party memory: OpenAI, Anthropic, Google

### Takeaway
First-party memory is file- or summary-based. Anthropic's memory tool is client-side files that the developer stores; OpenAI's ChatGPT memory is a consumer product with a 2026 "Dreaming" refresh; Google's Memory Bank is a managed Agent Engine service with GA billing from early 2026.

### Cited Findings
- **Anthropic memory tool:** type `memory_20250818`, name `memory`; no input schema; available on all Claude 4+ models; "status: stable" on the docs. Claude requests file operations (view, create, str_replace, insert, delete, rename) under `/memories`, and the developer's application runs them against storage they control. Path traversal protection is the developer's responsibility. The docs say the memory tool pairs with context editing and with server-side compaction. Source: [platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- Anthropic launch claim: memory tool plus context editing improved performance 39% over baseline; context editing alone 29%. Source: [anthropic.com/news/context-management](https://www.anthropic.com/news/context-management) (search summary; not fetched; conditions unverified)
- The fetched docs list no separate charge for the memory tool itself; storage is the developer's. Source: [platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- **ChatGPT memory:** secondary sources report "Dreaming V3" rolling out to Plus and Pro in the US from June 4, 2026, with memories refreshed over time, and internal factual recall rising from 67.9% (2025) to 82.8% (2026). Secondary outlets conflict on details. Sources: [help.openai.com/en/articles/8590148-memory-and-newer-features-](https://help.openai.com/en/articles/8590148-memory-and-newer-features-) (search result); [openai.com/index/chatgpt-memory-dreaming](https://openai.com/index/chatgpt-memory-dreaming) (search result; not fetched); [tech-insider.org/chatgpt-dreaming-v3-memory-update-2026/](https://tech-insider.org/chatgpt-dreaming-v3-memory-update-2026/) (search result; secondary)
- ChatGPT Enterprise: workspace owners can turn memory on or off for all users. Source: [help.openai.com/en/articles/8590148-memory-and-newer-features-](https://help.openai.com/en/articles/8590148-memory-and-newer-features-) (search result)
- **Google Memory Bank (Vertex AI Agent Engine):** release notes indicate Sessions and Memory Bank reached GA around Dec 2025, with billing starting Feb 11, 2026 (delayed from Jan 28). A third-party guide reports $0.25 per 1,000 stored memories or events; not verified against Google's pricing page. Sources: [docs.cloud.google.com/agent-builder/release-notes](https://docs.cloud.google.com/agent-builder/release-notes?authuser=7) (search result); [cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview?hl=en) (search result)
- Google's pricing page fetch was truncated and returned no Memory Bank figures. Source: [cloud.google.com/vertex-ai/generative-ai/pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) (fetch failed to extract)
- **OpenAI Responses API memory:** my search returned nothing on a Responses API memory feature.

### Inferences
- Anthropic's design is deliberately thin: a file protocol with developer-owned storage, which makes deletion, tenancy and compliance the customer's problem. This is the main structural opening for vendors like Supermemory and Mem0 to sell hosted tenancy and compliance.
- Consumer "dreaming" (OpenAI) and sleep-time (Letta) are both background rewriting of external memory, not weight updates.

### Gaps
- Responses API / Assistants memory not found.
- Google Memory Bank per-unit price unverified.
- OpenAI "Dreaming" details rely on secondary press; primary openai.com post not read.

## 3. Standard benchmarks and their validity

### Takeaway
LoCoMo, LongMemEval, BEAM, MemoryAgentBench and ConvoMem are the common set. Vendors report LoCoMo and LongMemEval almost exclusively. An April 2026 independent audit found 6.4% of LoCoMo answers wrong and a judge that accepts most topically adjacent wrong answers, which undercuts the leaderboard.

### Cited Findings
- **LoCoMo** (Maharana et al., ACL 2024): 1,540 questions. Source: [mem0.ai/blog/ai-agent-memory-benchmark](https://mem0.ai/blog/ai-agent-memory-benchmark) (describes the benchmark)
- **LoCoMo audit (Penfield Labs, posted Apr 4, 2026):** 99 score-corrupting errors in 1,540 questions (6.4%); the judge (gpt-4o-mini, same config as published evals) accepted 62.81% of intentionally wrong answers; specific factual errors caught about 89% of the time, vague topical answers passed nearly two-thirds of the time; authors estimate a ceiling of about 93.6% for a perfect system. Scripts at github.com/dial481/locomo-audit. Source: [dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg) (fetched); [github.com/dial481/locomo-audit](https://github.com/dial481/locomo-audit) (linked from post; not fetched). Affiliation of the audit's authors was not assessed.
- **Simple baselines:** a Salesforce AI Research paper is cited in search summaries as showing filesystem operations reaching 74% on LoCoMo; I could not locate the paper URL. Source: [dev.to/gaurav_dadhich/the-state-of-ai-memory-in-2026-claimed-vs-observed-1n94](https://dev.to/gaurav_dadhich/the-state-of-ai-memory-in-2026-claimed-vs-observed-1n94) (search result; unverified). Letta's own figure for filesystem storage is 74.0 (per Mem0's table). Source: [mem0.ai/blog/ai-agent-memory-benchmark](https://mem0.ai/blog/ai-agent-memory-benchmark)
- **Vendor-to-vendor disputes:** Zep vs. Mem0 on LoCoMo (Zep: "lies, damn lies, statistics"). Source: [getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory](https://www.getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/) (URL only)
- **LongMemEval:** 500 questions, six categories including knowledge updates. Source: [mem0.ai/blog/ai-agent-memory-benchmark](https://mem0.ai/blog/ai-agent-memory-benchmark); LongMemEval paper arXiv 2410.10813 per [supermemory.ai/research](https://supermemory.ai/research)
- **MemoryAgentBench** (Hu, Wang, McAuley; ICLR 2026 per search result): four competencies (accurate retrieval, test-time learning, long-range understanding, selective forgetting); reviewers flagged selective forgetting as somewhat artificial and the benchmark as language-QA only. Source: [arxiv.org/abs/2507.05257](https://arxiv.org/abs/2507.05257) (search result)
- **BEAM** (arXiv 2510.27246 per Supermemory page): 1M and 10M token tests. Mem0 reports a ~25% drop from 1M to 10M. Source: [supermemory.ai/research](https://supermemory.ai/research); [mem0.ai/blog/ai-agent-memory-benchmark](https://mem0.ai/blog/ai-agent-memory-benchmark)
- **ATM-Bench** (arXiv 2603.01990) and **SWE-ContextBench** (arXiv 2602.08316): cited by Supermemory; SWE-ContextBench's paper says the authors ran it, while Supermemory's research post says Supermemory did not run it. Source: [supermemory.ai/research](https://supermemory.ai/research)

### Inferences
- Reported numbers are not comparable across vendors. Each vendor fixes its own answer model, judge, top-k and dataset revision. Mem0's own post lists these variables as sources of variance.
- Critics across vendors argue LoCoMo is single-session and short-horizon, so it rarely tests knowledge updates, staleness or contradictions. Source: [dev.to/esteyang/what-memory-benchmarks-dont-test-h9c](https://dev.to/esteyang/what-memory-benchmarks-dont-test-h9c) (search result; unverified)

### Gaps
- Latest MemoryAgentBench scores for specific products not found.
- BEAM original paper not read; no independent head-to-head on BEAM found.
- The Salesforce 74% paper not located.
- Independent reproductions of vendor headline numbers (Supermemory 94%, Mem0 92.5/94.4) not found.

## 4. Enterprise connectors, sync, permissions and deletion

### Takeaway
Connector coverage is thin in the vendor set I checked. Supermemory's documented connectors are Google Drive, Notion and OneDrive, with Gmail and S3 gated to paid tiers. None of the pages I read document how permission (ACL) changes or deletions propagate from the source system. Treat ACL propagation as unverified for every vendor here.

### Cited Findings
- Supermemory connectors: Google Drive, Notion, OneDrive; Gmail (Max+); S3 and web crawler (Scale+); plugins for Claude Code, Cursor, Hermes. Source: [supermemory.ai/pricing](https://supermemory.ai/pricing); [supermemory.ai/docs/connectors/overview](https://supermemory.ai/docs/connectors/overview) (search result)
- Supermemory sync: real-time via webhooks plus scheduled sync every 4 hours; manual sync for Drive; scoped Drive sync that can skip a connector until a selection is saved. Source: [supermemory.ai/docs/connectors/overview](https://supermemory.ai/docs/connectors/overview) (search result, summarized)
- Supermemory's Slack presence is described as a separate product experience, not a connector. Source: search result only; not confirmed.
- Supermemory "workspace source permission matrix" blog exists by title; not read. Source: [supermemory.ai/blog/workspace-source-permission-matrix.md](https://supermemory.ai/blog/workspace-source-permission-matrix.md) (title only)
- Zep: Episodes are the unit of ingestion, and the docs define no connector list in the pages I read; enterprise adds SSO/SCIM, audit logs and BYOC. Source: [getzep.com/pricing](https://www.getzep.com/pricing)
- Mem0: Custom tier lists custom integrations, SSO, audit logs; no connector list on pricing page. Source: [mem0.ai/pricing](https://mem0.ai/pricing)
- Anthropic memory tool: no connectors; memory files live in the developer's storage, so ACL and deletion are the developer's responsibility per the docs. Source: [platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)

### Inferences
- "Universal connector" coverage (MCP, Slack, Gmail, Jira, Confluence, GitHub) is not evidenced by any memory vendor I read. Connector breadth appears to sit in adjacent products (enterprise search, RAG platforms) more than in memory SDKs.
- Deletion in memory products is an explicit feature only in Anthropic's file model (delete command) and Cognee's API (forget). Source: [cognee.ai/blog/cognee-news/cognee-1-0-announcement](https://www.cognee.ai/blog/cognee-news/cognee-1-0-announcement) (search result)

### Gaps
- No vendor documentation found for ACL mirroring, permission-change propagation or deletion-to-index propagation. The Supermemory permission matrix post was not opened.
- Slack, GitHub, Jira and Confluence connectors for memory vendors not confirmed on any primary page.
- MCP-specific connector coverage not examined.

## 5. Pricing models and unit economics

### Takeaway
Pricing units differ by vendor: Supermemory uses credits with per-1K-token meters; Zep uses per-350-byte "Episode" credits with zero-cost retrieval; Mem0 uses per-add and per-retrieval operations with a free tier tied to your own key; Google bills per stored memory or event. Costs per user are not published by any vendor I checked.

### Cited Findings
- Supermemory: Free $0; Pro $19/mo; Max $100/mo; Scale $399/mo; Enterprise custom. Storage not priced. Metered list rates as in Section 1. Source: [supermemory.ai/pricing](https://supermemory.ai/pricing)
- Zep: Flex $125/mo (50k credits), Flex Plus $375/mo (200k credits); 1 credit per 350-byte Episode; retrieval and storage at 0 credits. Source: [getzep.com/pricing](https://www.getzep.com/pricing)
- Mem0: Free tier (10k adds / 1k retrievals, or 50k / 10k with own key); paid custom. Source: [mem0.ai/pricing](https://mem0.ai/pricing)
- Google Memory Bank: $0.25 per 1,000 memories/events per a third-party guide; unverified. Billing from Feb 11, 2026. Source: [cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview?hl=en](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview?hl=en) (search result)
- Anthropic memory tool: no separate charge listed in the fetched docs. Source: [platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- Token-cost claims: Mem0 reports >90% token savings vs full context (2025 paper); Supermemory reports 5.0K tokens/query on LongMemEval-S and 6.1K on BEAM 1M; Mem0 2026 reports ~6.8-7.0K tokens/query. Sources: [arxiv.org/abs/2504.19413](https://arxiv.org/abs/2504.19413); [supermemory.ai/research](https://supermemory.ai/research); [mem0.ai/blog/ai-agent-memory-benchmark](https://mem0.ai/blog/ai-agent-memory-benchmark)
- Funding/traction: Cognee €7.5M seed (Feb 2026). Source: [dealroom.co/news/125999-cognee-raises-7-5m-to-build-memory-layer-for-ai-agents/](https://dealroom.co/news/125999-cognee-raises-7-5m-to-build-memory-layer-for-ai-agents/) (search result). Funding for Mem0, Zep, Letta, Supermemory not found in this pass.

### Inferences
- Zep's zero-credit retrieval means its cost is driven by ingestion volume; Mem0 and Supermemory charge for retrieval operations. For a read-heavy agent this changes the comparison materially.
- Per-user cost at scale can be derived from these rate cards but no vendor publishes a per-MAU reference.

### Gaps
- Mem0 paid per-op rates not public.
- Letta pricing not found.
- Google Memory Bank price unverified on primary page.
- Funding and traction for Mem0, Zep, Letta, Supermemory not found.

## 6. Vendors beyond memory: prompt/agent optimization, fine-tuning, per-user adapters, parametric learning

### Takeaway
No memory vendor I checked performs production per-user weight updates. Supermemory's 2026 "learner-1" continual-learning model is the only vendor claim I found in this direction, and it shows no benchmark numbers. Research on parametric or LoRA-based per-user memory exists (2026) with stated drawbacks (weight deletion, cost per update).

### Cited Findings
- Supermemory "learner-1" continual-learning model (2026; no numbers shown on research page). Source: [supermemory.ai/research](https://supermemory.ai/research)
- Letta sleep-time agents edit external memory blocks, not weights. Source: [letta.com/blog/sleep-time-compute](https://letta.com/blog/sleep-time-compute)
- Mem0 "Dream" consolidation and graph memory are external-store operations. Source: [mem0.ai/pricing](https://mem0.ai/pricing)
- NeurIPS 2026 paper compares 200-fact user memory in prompt vs. hypernetwork-compiled adapters: adapter recall drops as facts per adapter increase; prompt memory uses about 131x prompt tokens per query. Source: [neurips.cc/virtual/2026/171287](https://neurips.cc/virtual/2026/171287) (search result)
- "Route to Remember" proposes consolidating widely shared or recurring user knowledge into weights while keeping recent or individual details in a text store. Source: [arxiv.org/pdf/2611.05636](https://arxiv.org/pdf/2611.05636) (search result)
- "Scaling Self-Evolving Agents via Parametric Memory" (arXiv 2606.04536) and "RPMem" (arXiv 2609.23466) are 2026 research on parametric memory. Sources: [arxiv.org/pdf/2606.04536](https://arxiv.org/pdf/2606.04536); [arxiv.org/pdf/2609.23466](https://arxiv.org/pdf/2609.23466) (search results; not read)
- Survey-reported drawbacks: weights are hard to delete from (machine unlearning immature); per-fact updates are expensive; weight edits can interfere. Source: [arxiv.org/pdf/2606.30306](https://arxiv.org/pdf/2606.30306) (search result; survey title "Always-On Agents," not read in full)
- Prompt/agent optimization, fine-tuning and per-user adapter products: no vendor page found in this pass.

### Inferences
- The weight-learning direction is mostly academic in 2026. Vendors' "continual learning" framing (Supermemory learner-1) lacks evidence in the material I read.
- Deletion and compliance are the main reasons memory vendors stay external-store; this is a direct design constraint for any parametric approach.

### Gaps
- Supermemory learner-1 technical details not found.
- No vendor found selling per-user adapters or fine-tuning.
- Prompt-optimization products (e.g., DSPy-style or vendor "agent optimizer") not searched in this pass.
- Independent evaluation of any parametric memory product not found.
