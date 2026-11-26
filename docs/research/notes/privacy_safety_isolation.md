# Privacy, Tenant Isolation, Security and Regulatory Risks of AI Memory and Continual Learning (as of 2026-11-24)

Scope: external memory (RAG, agent memory stores) and per-tenant model adaptation (fine-tunes, LoRA adapters). Date-stamps are the source's publication or revision date. Items marked "snippet" were taken from search-result summaries and were not opened in full. Items marked "UNVERIFIED" conflict with other sources or could not be checked.

## 1. Memory-specific attacks (poisoning, injection, cross-tenant leakage, stale beliefs)

### Takeaway
Persistent memory turns a single adversarial write into a long-lived behavior change, and retrieval-time defenses are weak against it. Multi-tenant vector stores without per-tenant partitioning leak across users by default. Treat every memory write as untrusted input.

### Cited Findings
- Dash et al. (submitted 2026-06-03, v2 2026-06-18) build a taxonomy of memory poisoning with four memory write channels, nine structural vulnerabilities and six attack classes, and introduce the MPBench benchmark. Their conclusions: a single adversarial write can affect long-term behavior; more aggressive memory write and retrieval policies are more exploitable; existing prompt-injection defenses do not cover memory poisoning. The abstract gives no numeric attack success rates. — [arXiv:2606.04329](https://arxiv.org/abs/2606.04329) (fetched, 2026-06)
- A search summary attributes a 50.46% average attack success rate to the same paper. I could not confirm this from the abstract. **UNVERIFIED**; check the full text before citing. — [arXiv:2606.04329 PDF](https://arxiv.org/pdf/2606.04329) (snippet)
- MINJA (query-only memory injection, no direct write access to the memory bank): 98.2% average injection success and 76.8% average attack success across settings. A later paper reports about 95% and 70% under idealized conditions; another evaluation argues the original tests used minimal initial memory and fixed retrieval parameters, so realistic robustness is less certain. — [arXiv:2503.03704](https://arxiv.org/html/2503.03704v5) (snippet); [arXiv:2601.05504](https://arxiv.org/html/2601.05504) (snippet, 2026-01, EHR-agent memory poisoning attack and defense)
- AgentPoison (2024-07): poisons long-term memory or a RAG knowledge base with demonstrations and an optimized backdoor trigger; no training needed; average attack success above 80% across three agents; benign performance drops under 1% at poison rate under 0.1%. Retrieval-success numbers and defenses are not on the abstract page. — [arXiv:2407.12784](https://arxiv.org/abs/2407.12784) (fetched)
- Sleeper-style memory poisoning: external content (webpage/document) causes the assistant to store a fabricated user memory that affects later sessions. — [arXiv:2605.15338](https://arxiv.org/abs/2605.15338) (snippet, 2026-05)
- GhostWriter attack on tool-using personal agents; proposed defense AM-Sentry (memory-saving policy plus retrieval screen). — [arXiv:2607.06595](https://arxiv.org/abs/2607.06595) (snippet, 2026-07)
- MemPoison: a benchmark across attack types, injection channels and memory substrates; argues static filtering is insufficient and adaptive, context-sensitive defenses are needed. A search summary gives 1,227 cases; **UNVERIFIED**. — [arXiv:2607.14651](https://arxiv.org/abs/2607.14651) (snippet, 2026-07)
- Memory-backdoor variant ("MemPoison: Bypassing Selective Memory Mechanisms to Plant Backdoors"). — [arXiv:2605.29960](https://arxiv.org/pdf/2605.29960) (snippet, 2026-05)
- Defenses seen only by title/snippet: MIND (intent-aware information bottleneck, [arXiv:2607.28103](https://arxiv.org/pdf/2607.28103)); MEMSAD (gradient-coupled anomaly detection for memory poisoning, [arXiv:2605.03482](https://arxiv.org/pdf/2605.03482)). Effectiveness not verified.
- OWASP LLM08:2025 (Vector and Embedding Weaknesses, new in 2025, ranked 8th): risks are unauthorized access and leakage; cross-context leaks in multi-tenant shared vector DBs; embedding inversion (recovering much of the source text from vectors); data poisoning from insiders, prompts, seeded data or unverified providers; behavior alteration. Example: hidden white-on-white résumé text injecting instructions into a RAG screener. — [OWASP LLM08:2025](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/) (fetched, 2025 list, page current as of fetch)
- OWASP's mitigations: enforce permissions at retrieval time; permission-aware vector DB or separate indexes/namespaces per tenant; propagate source ACLs into embedding metadata and filter on every search; validate and authenticate sources before ingestion; scan for hidden content; immutable retrieval logs with user, tenant and document IDs. — [OWASP LLM08:2025](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/) (fetched)
- PoisonedRAG: no result retrieved in this pass. **Gap.**

### Inferences
- Defense set for the platform (my synthesis, not sourced as a tested combination): (a) provenance tag on every memory item (source, tenant, time, writer identity); (b) signed or authenticated writes from trusted pipelines only; (c) a staging/quarantine tier where new memories are not retrievable until validated (automated screen plus sampled human review for high-impact categories); (d) retrieval-time ACL filters, not post-filtering; (e) trust scores that down-rank low-provenance items and cap how much any single source can influence context.
- Cost of these: write-side gating adds latency and reviewer labor and delays memory freshness; trust-weighting can suppress legitimate but low-provenance facts; quarantine is the main product-level cost, and it trades against the "aggressive write" behavior that Dash et al. identify as more exploitable.
- Stale or incorrect beliefs are a separate risk class from attack. No source in this pass quantified stale-belief retrieval rates. **Gap.** Mitigation I would propose (not sourced): TTL and versioned facts with supersession, not append-only retrieval.

### Gaps
- Head-to-head defense numbers (false-positive cost of quarantine or trust scores) across the 2026 memory-poisoning papers. Not retrieved; the abstracts examined did not report them.
- PoisonedRAG results.
- Empirical measurement of stale-belief retrieval in enterprise memory systems.

## 2. Fine-tuning and adapter risks (memorization, extraction, membership inference, safety degradation, backdoors, supply chain)

### Takeaway
Fine-tuning can remove safety alignment cheaply, and benign data can degrade it too. Inference-time guardrails do not cover a customer's fine-tuned model. Memorization and membership inference for per-tenant adapters were not checked in this pass, so DP-based mitigations and their utility costs remain unverified here.

### Cited Findings
- Qi et al. (2023-10; the paper is 2023, not 2024 as the brief states; published version may differ): fine-tuning GPT-3.5 Turbo on 10 adversarially designed examples jailbroke it, at under $0.20 via the vendor API. Benign, commonly used datasets also degraded safety, to a lesser extent. Inference-time safety does not cover risks from user fine-tuning access. — [arXiv:2310.03693](https://arxiv.org/abs/2310.03693) (fetched)
- Follow-up 2024-2026 safety-degradation work (e.g., refusal-preserving fine-tuning, safety-data mixing): not retrieved in this pass. **Gap.**
- DP-SGD / DP-LoRA utility costs, membership inference and extraction results for LoRA adapters: not retrieved. **Gap.**
- Multi-tenant serving of adapters: the closest hits were a SALT paper that trains a shared centroid on provider-owned public data and isolates tenant data in a residual ([arXiv:2608.03579](https://arxiv.org/pdf/2608.03579), snippet), and an InfiniLoRA serving paper with no security analysis ([arXiv:2604.07173](https://arxiv.org/abs/2604.07173), snippet). No LoRA-specific side-channel or isolation paper was found. **Gap.**

### Inferences
- Because benign fine-tuning degrades safety (Qi et al.), per-tenant adaptation needs a safety eval gate on every adapter release, not only on the base model. Eval suite and refusal regression set are required artifacts.
- Cost: an eval gate on every adapter build adds compute and a release delay per tenant; it also needs a maintained harmful-prompt suite.
- Supply-chain risk: adapters are third-party-like artifacts. Treat adapter files as code: signed artifacts, hash pinning, provenance of training data, and a scan for backdoor triggers (not verified by a source in this pass).

### Gaps
- Quantified memorization/extraction risk for per-tenant LoRA vs full fine-tuning.
- DP-LoRA utility-loss numbers.
- Catastrophic-forgetting-of-safety monitoring methods (see section 6).

## 3. Tenant isolation patterns

### Takeaway
The best-sourced pattern is permission-aware retrieval with per-tenant indexes or namespaces, enforced at query time and logged. Side-channel risk in shared inference is documented for the base model's prefix/KV cache, not yet for shared LoRA serving.

### Cited Findings
- OWASP recommends separate indexes or namespaces per tenant or permission-aware stores, and warns of cross-tenant leakage in shared vector DBs. — [OWASP LLM08:2025](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/) (fetched)
- CacheSolidarity (2026-03): timing side channels from prefix caching in multi-tenant LLM serving; concerns the base-model KV cache. — [arXiv:2603.10726](https://arxiv.org/html/2603.10726v1) (snippet)
- "LLMs in Cloud" survey: multi-tenant KV-cache sharing creates prompt-leakage and hardware cache side-channel risks. — [arXiv:2610.33475](https://arxiv.org/pdf/2610.33475) (snippet, 2025-10)
- Per-tenant encryption keys (CMEK), row-level security, data residency: no 2026 source retrieved in this pass. **Gap.**

### Inferences
- Shared-weights-plus-per-tenant-retrieval has the lowest serving cost and the largest leakage surface through shared caches and shared embeddings. Per-tenant adapters reduce weight-level cross-leak but do not stop retrieval-level leak.
- Cost of per-tenant indexes: more index overhead, fewer cross-tenant shared-learning benefits; cost of disabling cross-tenant prefix caching: higher inference cost.

### Gaps
- Side-channel analysis specific to multi-LoRA serving.
- Vendor-specific CMEK, residency and RLS documentation (vendor trust pages not yet fetched).

## 4. Deletion and the right to be forgotten (memory vs weights; unlearning reliability)

### Takeaway
Deleting from a memory store is tractable; removing data from weights is not reliably achieved by current unlearning methods. The practical design is to keep personal data out of weights and to make tenant deletion a memory-store and retrain-from-ledger operation.

### Cited Findings
- TOFU (2024): 200 fictitious authors, 20 QA pairs each; the main finding is that none of the baseline unlearning methods were effective. — [arXiv:2401.06121](https://arxiv.org/abs/2401.06121) (fetched)
- OpenUnlearning (2025): unified framework with 13 unlearning algorithms and 16 evaluations across TOFU, MUSE and WMDP; flags that TOFU reuses training questions, which can inflate metrics, so paraphrased evaluation is used. Publishes more than 450 checkpoints. — [arXiv:2506.12618](https://arxiv.org/html/2506.12618v2) (snippet)
- MUSE targets removal of books and news from fine-tuned models; WMDP tests removal of hazardous knowledge from the base model's general training (3,668 multiple-choice questions). — [OpenUnlearning](https://arxiv.org/pdf/2506.12618) (snippet)
- 2026 unlearning papers using these benchmarks (method results, not a consolidated leaderboard): Attention Smoothing ([arXiv:2603.01285](https://arxiv.org/pdf/2603.01285)); Forget What Comes Next ([arXiv:2611.03955](https://arxiv.org/pdf/2611.03955)); Representation-Guided Parameter-Efficient Unlearning, which reports that methods show comparable utility under an MMLU criterion ([arXiv:2604.17396](https://arxiv.org/pdf/2604.17396)). (snippets)
- Consolidated 2026 leaderboard across TOFU, MUSE and WMDP: not found. **Gap.**
- EDPB Opinion 28/2024 on AI models (2024-12): anonymity of a model is assessed case by case; legitimate interest can be a legal basis for development and deployment with a high necessity bar; deployers should check whether the model was lawfully developed, since liability can extend to the deployer. Also notes the EDPB was developing guidance on anonymisation and scraping; I did not confirm publication of that guidance. — [EDPB Opinion 28/2024](https://edpb.europa.eu/system/files/2024-12/edpb_opinion_202428_ai-models_en.pdf) (snippet)

### Inferences
- Because unlearning is unreliable and metrics may be inflated, the platform should not rely on unlearning to satisfy erasure. Instead: (a) keep personal data in memory stores with hard delete and tombstones; (b) do not train on personal data in shared or per-tenant weights unless necessary; (c) for weights that did train on the data, retrain from a data ledger (the adapter is rebuilt from the ledger minus the deleted records) and treat retrain cost as the deletion SLA driver.
- Cost: retrain-from-ledger means storing and versioning training data, and deletion latency equals the adapter rebuild time; it also requires a per-tenant dataset registry.

### Gaps
- Empirical reliability of unlearning in 2026 under adversarial re-elicitation.
- Backup and derived-artifact deletion (caches, logs, embeddings) is not covered by any source here.

## 5. Regulation (GDPR, EU AI Act timeline, CCPA/CPRA, HIPAA/SOC 2/ISO 42001, vendor contracts)

### Takeaway
The EU AI Act high-risk deadline was moved from 2026-08-02 to 2027-12-02 (Annex III) under the Digital Omnibus on AI. The exact status is inconsistently reported and needs checking on EUR-Lex. Vendor terms state no training on customer content by default, with an opt-in exception.

### Cited Findings
- Digital Omnibus on AI: proposed 2025-11-19 to move the high-risk deadline from 2026-08-02 to 2027-12-02. — search summary citing the Commission proposal, [OneTrust blog](https://www.onetrust.com/blog/eu-digital-omnibus-proposes-delay-of-ai-compliance-deadlines/) (snippet); [Euronews 2025-11-19](https://www.euronews.com/2025/11/19/european-commission-delays-full-implementation-of-ai-act-to-2027) (snippet)
- Political agreement reported for 2026-05-07; new dates reported as 2027-12-02 for stand-alone Annex III systems and 2028-08-02 for AI embedded in regulated products (Annex I). — [Taylor Wessing, 2026-05](https://www.taylorwessing.com/de/insights-and-events/insights/2026/05/the-eu-digital-omnibus-on-ai-what-the-political-deal-means) (snippet; the fetch returned HTTP 403); [Pinsent Masons](https://www.pinsentmasons.com/Out-Law/News/Rules-high-risk-AI-delayed-under-EU-omnibus-deal) (snippet)
- Adoption status: one DLA Piper page (updated 2026-08-10, internally inconsistent: its body text still describes negotiations as ongoing) states Council final approval on 2026-06-29, Official Journal publication on 2026-07-24, and entry into force on 2026-07-27. It also says transparency obligations "took effect on 2 August 2026" and that the Annex III deadline is 2 December 2027. — [DLA Piper](https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2026/The-Digital-AI-Omnibus-Proposed-deferral-of-high-risk-AI-obligations-under-the-AI-Act) (fetched). **Single source; verify against EUR-Lex before use.**
- A search summary says some machine-readable marking deadlines for AI-generated content move to 2026-12-02. This conflicts with the DLA page's statement on transparency timing. **UNVERIFIED.** — [OneTrust](https://www.onetrust.com/blog/eu-digital-omnibus-proposes-delay-of-ai-compliance-deadlines/) (snippet)
- Anthropic Commercial Terms: Anthropic may not train models on Customer Content (inputs and outputs) under the current commercial terms; the Service Specific Terms describe an opt-in Development Partner Program in which the customer may enable training use. An archived version restricted the no-training commitment to paid services. Verify the live page, since the terms version dated 2025-06-17 may not reflect a 2026 revision. — [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) (snippet); [Service Specific Terms](https://www.anthropic.com/legal/service-specific-terms) (snippet)
- GDPR Art. 17 (erasure), Art. 22 (automated decisions), DPIA obligations; CCPA/CPRA; HIPAA; SOC 2; ISO/IEC 42001: no primary source retrieved in this pass. **Gap.**
- GPAI obligations dates: not verified in this pass. **Gap.**

### Inferences
- Plan the platform against the revised high-risk date but do not treat it as a reason to skip controls: GPAI obligations and GDPR apply regardless of the omnibus.
- Vendor no-training commitments should be written into the DPA and the agreement as contract terms, not assumed from defaults; confirm the opt-in setting is off for every tenant workspace.
- Erasure under GDPR Art. 17 maps directly onto section 4: memory deletion is the controllable part; weight retraining is the expensive part.

### Gaps
- Primary-text verification of the omnibus (EUR-Lex / Official Journal). Council and Commission pages returned HTTP 403.
- GDPR, HIPAA, SOC 2, ISO 42001 requirements specific to AI vendors.
- Vendor-by-vendor no-training terms beyond Anthropic.

## 6. Catastrophic forgetting as a safety issue

### Takeaway
Sequential or continual adaptation can erode safety behavior, and benign fine-tuning is enough to do it. Monitoring has to be continuous, not only at release. No 2026 monitoring method was verified in this pass.

### Cited Findings
- Benign fine-tuning degrades safety alignment without malicious intent. — [Qi et al., arXiv:2310.03693](https://arxiv.org/abs/2310.03693) (fetched)
- OWASP LLM08 notes behavior alteration from retrieval (e.g., reduced empathy while factually improved), a related drift symptom. — [OWASP LLM08:2025](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/) (fetched)

### Inferences
- Each continual-update cycle should rerun a fixed refusal and harmful-prompt regression suite plus a capability suite. Cost: eval compute per update and a reviewer loop for failures.

### Gaps
- Continual-learning-specific safety forgetting results from 2025-2026.
- Monitoring methods (drift detectors on refusal rates) with measured false-alarm rates.

## Source-level caveats
- Search-result summaries occasionally added numbers not present in the abstracts I opened (e.g., the 50.46% figure and the 1,227-case count). Those are flagged above.
- The brief calls Qi et al. a 2024 paper; the arXiv record is 2023-10.
- The EU omnibus status is from one internally inconsistent secondary source; verify on EUR-Lex before any compliance decision.
- Tool-call budget was reached before PoisonedRAG, DP-LoRA, GDPR, CMEK and vendor trust pages were checked; these are listed as gaps.
