# Automated Use-Case Model Adaptation Infrastructure (PEFT, Preference Optimization, Multi-Tenant Serving), as of 2026-11-24

Scope note: Research notes for a report writer. Sourced claims carry a link. Items marked **[derived]** are my arithmetic from sourced inputs, with the inputs stated. Items marked **[unverified]** came from a single secondary or vendor source that conflicted with another source or could not be checked against the primary page. Abstract-only fetches are noted where the equation or detail was not in the fetched text. Price stamps are the date the source states, or the fetch date if none.

---

## 1. Methods

### Takeaway
LoRA is the default PEFT method. Its core update is a low-rank additive term with an α/r scale. Thinking Machines' 2025 study found LoRA matches full fine-tuning on small-to-medium SFT and RL, with specific failure modes: attention-only targeting, large batches, and capacity limits on large datasets. QLoRA extended the method to 65B-scale fine-tuning on one 48GB GPU. DPO-family and GRPO-family methods have been compared in several places, but no single controlled 2026 study I found covers all of them under identical conditions.

### Cited Findings

**LoRA (equation and scaling)**
- LoRA freezes the pretrained weights and injects trainable rank-decomposition matrices into each Transformer layer; for GPT-3 175B it reduces trainable parameters by 10,000x and GPU memory by 3x (abstract, not full text) — [LoRA, arXiv:2106.09685](https://arxiv.org/abs/2106.09685)
- Parameterization used in the TML study: W' = W + (α/r)BA, with α = 32 throughout; the 1/r factor makes the optimal learning rate approximately independent of rank; under Adam, the learning-rate optimum shifts by less than 2x between rank 4 and rank 512 — [LoRA Without Regret, Thinking Machines](https://thinkingmachines.ai/blog/lora/)
- Standard init per that study: A uniform with scale 1/sqrt(d_in), B zero-initialized, α = 32 — [same](https://thinkingmachines.ai/blog/lora/)
- LoRA uses slightly more than 2/3 of full fine-tuning's FLOPs per pass, ignoring attention FLOPs — [same](https://thinkingmachines.ai/blog/lora/)

**LoRA Without Regret (TML, 2025)** — [thinkingmachines.ai/blog/lora](https://thinkingmachines.ai/blog/lora/)
- Optimal LoRA learning rate is about 10x the full fine-tuning rate (fitted multiplier 9.8); short runs (under ~100 steps) may favor ~15x (anecdotal)
- LoRA matches full fine-tuning on small-to-medium SFT (instruction and reasoning) datasets; it underperforms when the dataset exceeds LoRA's capacity
- Attention-only LoRA significantly underperforms MLP-only LoRA. Attention-only rank 256 (0.25B params) underperforms MLP-only rank 128 (0.24B), so parameter count does not explain it. Adding attention to MLP-only gave no further benefit
- LoRA is less tolerant of large batch sizes than full FT; the penalty grows with batch size and does not depend on rank
- In RL, LoRA "performs equivalently to FullFT ... even with ranks as low as 1" (the authors estimate ~3M params for rank-1 on Llama-3.1-8B)
- Reproduced by Hugging Face TRL with SmolLM3 — [TRL docs](https://huggingface.co/docs/trl/main/en/lora_without_regret) (secondary confirmation)

**QLoRA**
- 4-bit NF4 base, double quantization, paged optimizers; fine-tunes a 65B model on a single 48GB GPU "while preserving full 16-bit finetuning task performance" — [QLoRA, arXiv:2305.14314](https://arxiv.org/abs/2305.14314)
- The Guanaco "99.3% of ChatGPT" figure is caveated by the authors themselves: they state chatbot benchmarks are not trustworthy and show a lemon-picked failure analysis. Do not cite 99.3% as a capability claim — same source

**DoRA**
- Decomposes pretrained weights into magnitude and direction; LoRA updates only the direction; "consistently outperforms LoRA" across the tasks tested; authors claim no added inference overhead — [DoRA, arXiv:2402.09353](https://arxiv.org/abs/2402.09353) (abstract only; the specific LLaMA-7B/13B commonsense numbers were not in the fetched text)

**DPO**
- Reparameterizes RLHF so the LM is the implicit reward model; the abstract reports DPO exceeds PPO-based RLHF at controlling sentiment and matches or improves summarization and dialogue quality, with simpler training — [DPO, arXiv:2305.18290](https://arxiv.org/abs/2305.18290) (abstract only; the loss equation was not in the fetched text, so I did not verify it here; use the paper's HTML version)

**SimPO**
- Reports SimPO beats DPO by up to 6.4 points on AlpacaEval 2 and up to 7.5 on Arena-Hard (the authors' own comparison) — [SimPO, arXiv:2405.14734](https://arxiv.org/html/2405.14734v1) (figures from search summary of the paper; not separately fetched)

**IPO / KTO / ORPO / CPO**
- Saeidi et al. compare DPO, IPO, KTO, CPO on Mistral 7B: CPO and KTO perform similarly to SFT-based models, unlike IPO and DPO — [arXiv:2404.14723](https://www.arxiv.org/pdf/2404.14723) (search summary; not fetched)
- A 2026 controlled benchmark evaluates 20 DPO variants (including IPO, SimPO, KTO, ORPO) under identical conditions; the authors note each algorithm paper uses different base models, datasets, and evals, so cross-paper comparisons are unreliable — [arXiv:2603.19335](https://arxiv.org/html/2603.19335) (search summary; the key results table was not checked)

**GRPO / RL fine-tuning**
- GRPO is a PPO variant introduced in DeepSeekMath to reduce PPO's memory use (group-relative baseline; the abstract gives no quantified savings) — [DeepSeekMath, arXiv:2402.03300](https://arxiv.org/abs/2402.03300) (abstract only; advantage formula and KL term not verified)

**Managed RL fine-tuning**
- OpenAI RFT is billed by training time, not tokens: $100 per hour of wall-clock time in the core training loop for o4-mini-2025-04-16; rollouts, grading, and weight updates are billable; dataset validation, queue time, and safety evaluation are not; model-based grader tokens are billed separately at inference rates — [OpenAI RFT billing guide](https://help.openai.com/en/articles/11323177-billing-guide-for-the-reinforcement-fine-tuning-api) (page marked "Updated: last month", no date)
- Example from that page: 4 billable hours = $400

**Distillation**
- Google Vertex AI open-model tuning supports distillation fine-tuning: a teacher (GLM 5.2 MaaS in the doc) generates responses that tune a smaller student (Qwen 3 4B–32B, Gemma 3 1B–27B). The teacher's usage consumes project quota and is billed — [Vertex open-model tuning](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tuning/open-model-tuning)
- Google recommends distillation for multi-step reasoning tasks (same page)
- Bedrock lists distillation as a current method, teacher-generated responses to fine-tune a smaller student — [AWS Bedrock customization docs](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models.html) (search summary)

**Test-time learning, on-policy distillation**
- No sourced findings collected. See Gaps.

### Inferences
- The LoRA scaling and learning-rate results imply that a single LR transferred from full FT will underfit LoRA by roughly an order of magnitude; teams should sweep LoRA LR separately.
- The attention-only failure mode means default adapter configs targeting only q/k/v/o are a known weak choice for SFT tasks.
- Preference optimization variants do not have a settled ranking in the sources I found. Choose by compute and data type, not by a leaderboard from an algorithm paper.

### Parameter counts and memory (**[derived]**)
Assumptions: Llama-3.1-8B dimensions (32 layers, hidden 4096, MLP intermediate 14336, 8 KV heads × 128 = 1024 KV dim) from the public model config. I did not fetch a source for these dimensions; verify against the model card before citing.
- LoRA rank 16 on all linear layers (q, k, v, o, gate, up, down): per layer = 16×[(4096+4096)+(4096+1024)+(4096+1024)+(4096+4096)+3×(4096+14336)] = 1,310,720; × 32 layers ≈ **41.9M params**
- Same with attention-only (q, k, v, o): ≈ **13.6M params**
- Storage at rank 16 all-linear: bf16 ≈ 84 MB; fp32 ≈ 168 MB. Attention-only bf16 ≈ 27 MB
- Base 8B weights: bf16 ≈ 16 GB; 4-bit ≈ 5–6 GB (QLoRA regime)
- Full FT with Adam in mixed precision: roughly 16 bytes/param of optimizer and gradient state, ≈ 128 GB for 8B before activations (standard estimate, not sourced)
- 70B: bf16 weights ≈ 140 GB; 4-bit ≈ 35–40 GB, which is consistent with the QLoRA claim of 65B on 48GB once activations are included

### Gaps
- Could not fetch the DPO loss equation, GRPO advantage formula, rsLoRA, LoRA+, VeRA, or prefix/adapter tuning details. Those need the full papers.
- No source collected on on-policy distillation, test-time training, or RLVR specifics beyond the names.

---

## 2. Evidence on memory/RAG vs weight adaptation

### Takeaway
The most-cited controlled studies find RAG beats unsupervised fine-tuning for injecting facts, including facts that were new to the model, and that fine-tuning on new facts is slow and can increase hallucination. Fine-tuning is better suited to format, style, and procedure. I found no controlled 2025–2026 three-way study of long-context vs RAG vs fine-tuning on the same tasks; that gap matters for the decision framework.

### Cited Findings
- Ovadia et al. (Microsoft Israel, EMNLP 2024): unsupervised fine-tuning gives some improvement, but RAG "consistently outperforms it, both for existing knowledge encountered during training and entirely new knowledge." LLMs struggle to learn new facts through unsupervised fine-tuning; exposure to many variations of the same fact helps — [arXiv:2312.05934](https://arxiv.org/abs/2312.05934); [ACL Anthology](https://aclanthology.org/2024.emnlp-main.15). Numerical results were not in the fetched abstract.
- Gekhman et al., "Does Fine-Tuning LLMs on New Knowledge Encourage Hallucinations?": examples that add new facts are learned "significantly slower" than examples consistent with existing knowledge; once learned, they "linearly increase the model's tendency to hallucinate" — [arXiv:2405.05904](https://arxiv.org/abs/2405.05904) (abstract; specific rates not in fetched text)
- Allen-Zhu & Li: models store about 2 bits of knowledge per parameter, even when quantized to int8 — [arXiv:2404.05405](https://arxiv.org/abs/2404.05405). Used only to bound capacity; it is not a fine-tuning result.
- Long context vs RAG: ChatQA 2 reports RAG can still outperform GPT-4-Turbo-level long-context models at 32K and 128K given enough top-k chunks — [arXiv:2407.14482](https://arxiv.org/pdf/2407.14482). LongBench v2 shows some models do better with 32K retrieved context than with the full 128K window, and only GPT-4o uses longer retrieval contexts well — [arXiv:2412.15204](https://arxiv.org/pdf/2412.15204). Long-context vs RAG results are mixed on full-length novels (SagaScale: Gemini-2.5-Pro scored higher with long context) — [arXiv:2601.09723](https://arxiv.org/pdf/2601.09723). Long Context vs RAG (Li et al., 2025) stresses context relevance — [arXiv:2501.01880](https://arxiv.org/html/2501.01880v1) (headline numbers not captured)
- Clinical QA study: medical fine-tuning did not beat its instruction-tuned base; RAG helped smaller models — [arXiv:2510.18691](https://arxiv.org/pdf/2510.18691)
- REFRAG: fine-tuning a model specifically for RAG beats a fine-tuned LLaMA baseline with 2–4x fewer decoder tokens — [arXiv:2509.01092](https://arxiv.org/pdf/2509.01092)

### Inferences
- Facts that must be known from a stable corpus are better handled by retrieval: updatable, citable, and less prone to the new-knowledge hallucination effect.
- Weight adaptation is most supported by evidence for *behavior*: format, tone, tool-call schema, procedural steps. The sources here are indirect; I did not find a clean study isolating behavior vs fact in the same setup.
- Fine-tuning on data the base model already "knows" is less risky than teaching new facts (Gekhman).

### Gaps
- No head-to-head 2025–2026 study of long-context vs RAG vs fine-tuning on the same tasks with cost reported. Needs targeted search.
- Ovadia's and Gekhman's numerical tables were not fetched; cite the abstract claims only, or fetch the full HTML.

---

## 3. Multi-tenant adapter serving

### Takeaway
Serving many LoRA adapters on one base model is established in open-source systems: vLLM, SGLang, LoRAX, S-LoRA, and Punica. Each system has a GPU-resident slot pool with CPU or disk tiers behind it. Published numbers mostly come from research papers' abstracts or vendor blogs. The most reliable concrete parameters are the config defaults in the official docs. Independent latency measurements are thin.

### Cited Findings

**vLLM**
- Flags: `--enable-lora`, `--lora-modules`, `--max-lora-rank` (set to the actual maximum rank; larger wastes memory), `--max-loras`, `--max-cpu-loras`, `--lora-target-modules` (restricting to needed layers can improve performance) — [vLLM LoRA docs](https://docs.vllm.ai/en/latest/features/lora.html)
- Runtime adapter loading requires `VLLM_ALLOW_RUNTIME_LORA_UPDATING=True`, flagged as a security risk for untrusted environments — same
- In-place reloading lets updated weights swap under the same name without interrupting inference, which the docs suggest for asynchronous RL — same

**SGLang**
- `--max-loras-per-batch`: GPU pool capacity in distinct adapter IDs, default 8 (includes one slot for base-model requests); more slots use more GPU memory — [SGLang LoRA docs](https://docs.sglang.io/advanced_features/lora.html)
- `--max-loaded-loras`: CPU-side cap; must be ≥ `--max-loras-per-batch`; eviction LRU by default or FIFO — same
- Dynamic `/load_lora_adapter` and `/unload_lora_adapter`; admin endpoints require an admin key; dynamically loaded adapters must match startup shape or be smaller — same
- Reported: `csgmv` kernel gives 20–80% latency improvement over `triton` at high concurrency; overlap loading reduces median TTFT ~35% under adversarial load (off by default; can hurt TTFT when loads are fast) — same (the docs' own numbers; conditions not given)

**S-LoRA (OSDI 2024)**
- Stores all adapters in host memory, fetches the adapters needed by running queries to GPU; Unified Paging for adapters of different ranks and KV cache; custom CUDA kernels for heterogeneous batching — [S-LoRA project](https://sky.cs.berkeley.edu/project/s-lora/); [arXiv:2311.03285](https://arxiv.org/abs/2311.03285)
- Thousands of adapters on one or several GPUs with small overhead; up to 4x throughput vs HF PEFT and vLLM (naive LoRA) per the abstract; "several orders of magnitude" more adapters. One PDF rendering in search results showed "30x" vs PEFT; the arXiv abstract says 4x — treat 4x as the cited figure
- Code: [github.com/S-LoRA/S-LoRA](https://github.com/S-LoRA/S-LoRA) (built on LightLLM)

**Punica**
- Custom CUDA kernel batches across different LoRA models; a single base-model copy on GPU; reports 12x throughput vs SOTA LLM serving on a fixed cluster and ~2 ms per-token latency overhead — [arXiv:2310.18547](https://arxiv.org/abs/2310.18547) (abstract; hardware and baselines not in fetched text)

**LoRAX (Predibase)**
- Keeps one base model per GPU, loads adapters per request; tiered cache across GPU, CPU, and disk with LRU; requests for different adapters share a batch — [LoRAX](https://github.com/predibase/lorax) (the official docs site did not resolve; claims from search summaries)
- Vendor claim: ~200 ms overhead to load a new adapter; "upwards of 100" fine-tuned models per GPU — [Predibase/LoRAX writeups via search](https://machinelearningmastery.com/fast-and-cheap-fine-tuned-llm-inference-with-lora-exchange-lorax/) (2023 material)
- Conflict: a TrueFoundry experiment reported latency rising with adapter count as memory pressure grew; a later summary says latency stayed stable — [TrueFoundry](https://www.truefoundry.com/blog/scaling-up-serving-of-fine-tuned-lora-models). Treat latency-vs-adapter-count as unresolved

**Fireworks (managed multi-LoRA)** — [Fireworks multi-LoRA blog](https://fireworks.ai/blog/multi-lora-serving)
- Vendor claims: hundreds of LoRAs on one base; inference speed "approach 90% of base model performance"; LoRAs load or unload "within seconds"; serving LoRAs priced at base-model rate. No benchmark conditions given.
- Llama 3.1 8B cited at $0.2 per 1M tokens (vendor page, date not stamped)
- Pricing page: LoRA models on serverless cost the same as the base; no added serving fee — [Fireworks pricing](https://app.fireworks.ai/pricing) (secondary summaries conflict on whether tuned models are served serverless vs only on-demand; verify)

**Per-user adapters (research)**
- OPPU (One PEFT Per User): each user gets a personal PEFT module (LoRA default), typically <1% of base params; beats baselines across seven LaMP tasks — [arXiv:2402.04401](https://arxiv.org/abs/2402.04401)
- Counter-evidence: Profile-to-PEFT says training one PEFT per user is computationally expensive at scale and proposes a hypernetwork that generates adapters from a profile in one pass — [arXiv:2510.16282](https://arxiv.org/pdf/2510.16282)

### Inferences
- The sources converge on a shared base with many adapters as the efficient multi-tenant design. The practical limits are GPU slot count (max-loras / max-loras-per-batch), max rank, and host-memory tiering.
- Per-user adapters are supported by the serving stack but the training cost per user is the bottleneck; the sources do not give a break-even point. A per-tenant or per-app adapter is much easier to justify than per-user.
- Separate foundation models per tenant make sense only when tenants need different base architectures, licenses, or data residency that a shared base cannot meet. The sources I found do not analyze this trade-off quantitatively.

### Gaps
- No independent benchmark of hot-swap latency across vLLM, SGLang, and LoRAX on the same hardware, in 2025–2026.
- NVIDIA NIM / TensorRT-LLM LoRA: not researched. Modal serving: not researched.
- Adapters per GPU: vendor claims range from "upwards of 100" to "hundreds" with no memory accounting; compute from adapter size and free VRAM before relying on them.

---

## 4. Managed fine-tuning offerings and closed-model adaptation (as of 2026-11-24)

### Takeaway
Open-weight adaptation is available broadly (Vertex, Together, Fireworks, Tinker, Bedrock for some models). Closed frontier-model per-tenant weight adaptation is not generally available: OpenAI says it is winding down its fine-tuning platform, and Anthropic's Bedrock fine-tuning covered only Claude 3 Haiku, which reached end of life on 2026-09-10. Vertex and Together prices are not reliably verified for 2026.

### Cited Findings

**Thinking Machines Tinker** — [pricing](https://thinkingmachines.ai/tinker/pricing/) (fetched; stamped "as of October 19, 2026")
- Usage-based, per 1M tokens, three meters: prefill, sample, train. Checkpoint storage $0.10/GB/month. No minimums listed. Serverless inference is beta, waitlisted.
- Selected rates (USD/1M tokens, as listed at the stated context): Qwen3-8B (32K): prefill $0.195, sample $0.60, train $0.44; Qwen3.5-9B (64K): prefill $0.30, sample $0.807, train $1.463; GPT-OSS-20B (32K): train $0.396; Inkling 2 Mini (64K): train $0.75; Inkling (64K): train $5.61; Kimi-K2.6 (32K): train $4.84
- Mixture-of-experts priced by active parameters
- Conflicts: a search snippet quoted an Oct 14 stamp; a Withorb page quoted $0.036/1M tokens, which does not match the official table — discard. A Forkast claim of a $10K minimum for beta was not in the official page — [unverified]

**OpenAI**
- Fine-tuning is being wound down: "OpenAI is winding down the fine-tuning platform," no longer open to new users; existing users can create jobs "for the coming months"; fine-tuned models stay available for inference until their base models are deprecated — [OpenAI model optimization page](https://developers.openai.com/api/docs/guides/model-optimization). Third-party claims of specific dates (new jobs stop 2027-01-06) are [unverified]
- The page lists SFT, vision FT, and DPO for gpt-4.1 / gpt-4o snapshots as "supported but part of the wind-down." It does not mention RFT in the fetched text
- Per-token SFT training prices: only secondary sources, which conflict (e.g., GPT-4.1 at $25/1M vs a different figure from another aggregator). [unverified; gap]
- RFT: see §1, $100/hour for o4-mini

**Google Vertex AI**
- Gemini supervised tuning: the official pricing page was not reachable with specific tuning rates in my search. An older snippet listed $3.00 per 1M training tokens (model not stated). [unverified]
- Open-model tuning (SFT with PEFT or full; distillation) supported for Gemma 4 (E2B, E4B, 26B A4B, 31B; PEFT), Gemma 3 (1B–27B), Qwen 3/3.5/3.6/3.8, Llama 3.1 8B (PEFT and full), Llama 3.3 70B Instruct (PEFT and full), Llama 4 Scout (PEFT, 2048 seq len) — [Vertex open-model tuning](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tuning/open-model-tuning). Max seq length 8192 for most (12288 for Qwen 3.6/3.8 PEFT)
- Tuning billed per training token (dataset tokens × epochs); distillation also bills teacher calls; storage and prediction billed separately. Hardware and adapter size not stated; the deployment example uses one NVIDIA L4

**Together AI** — [fine-tuning pricing](https://docs.together.ai/docs/fine-tuning-pricing)
- $4.00 minimum per fine-tuning job
- Blog (secondary-confirmed): price cuts on LoRA training; Qwen3.5-9B SFT $0.48 → $0.34/1M training tokens, DPO $1.20 → $0.84; a 27B-class SFT $1.50 → $1.05, DPO $3.75 → $2.62 — [Together blog](https://together.ai/blog/together-ai-expands-fine-tuning-service-with-more-models-live-metrics-and-finer-controls). Undated in my extract; confirm on the pricing page
- Dedicated endpoints for tuned models billed per hour separately

**Fireworks** — see §3. Billing per training token; LoRA cheapest, full-parameter 2x LoRA, DPO 2x again [unverified, third-party]. GPU on-demand figures from third-party trackers ($7/hr H100, $10/hr B200) are [unverified]

**AWS Bedrock**
- Claude 3 Haiku fine-tuning: preview July 2024, GA November 1, 2024 (US West Oregon), text only at GA — [Anthropic](https://www.anthropic.com/news/fine-tune-claude-3-haiku-ga); [AWS](https://aws.amazon.com/about-aws/whats-new/2024/11/fine-tuning-anthropics-claude-3-haiku-amazon-bedrock)
- AWS blog states Claude 3 Haiku reached end of life on 2026-09-10 — [AWS ML blog](https://aws.amazon.com/jp/blogs/machine-learning/fine-tune-anthropics-claude-3-haiku-in-amazon-bedrock-to-boost-model-accuracy-and-quality)
- Bedrock customization docs list supervised fine-tuning, reinforcement fine-tuning, and distillation as methods — [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models.html) (search summary); which Claude models support these in 2026 was not confirmed. The Haiku 5.5 model card does not mention customization — [AWS model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html)

**Anthropic**
- I found no evidence of a current Anthropic-hosted fine-tuning API for Claude in 2026. Treat as "not generally available" pending confirmation from Anthropic docs.

**Not researched (gaps):** Predibase current pricing, Modal, AWS SageMaker, NVIDIA NIM, Databricks, Anyscale, pricing pages for these.

### Inferences
- Closed frontier models: per-tenant weight adaptation is not available as a generally offered product in 2026 from the major closed providers in the sources I checked. The workable options are (a) prompt/context engineering and retrieval, (b) provider-hosted tuning of a smaller open-weight model, or (c) self-hosted open weights with adapters.
- For an infrastructure company, the defensible position is the open-weight adapter layer: train, version, and serve adapters on an open base. Dependence on OpenAI's fine-tuning is risky given the announced wind-down.
- Tinker's per-token meter makes training costs roughly comparable across models; the Qwen3-8B train rate ($0.44/1M) is useful as a reference point.

### Gaps
- Current OpenAI SFT per-token rates: not verified from the official pricing page.
- Gemini supervised tuning per-token rates for 2026: not verified.
- Together and Fireworks 2026 pricing: date-stamped only via secondary sources.

---

## 5. Automated training-data curation, triggers, and adapter operations

### Takeaway
I did not complete this section. The sourced material I collected here is the routing evidence (RouteLLM) and the serving-side versioning hooks from vLLM and SGLang. Data selection, dedup, drift detection, and registry practices need a follow-up pass.

### Cited Findings
- RouteLLM (Ong et al., ICLR 2025): learns to route between strong and weak models from human preference data (Chatbot Arena) with data augmentation; claims over 2x cost savings with minimal quality loss; the project page reports cost reductions of 85% on MT Bench, 45% on MMLU, 35% on GSM8K — [arXiv:2406.18665](https://arxiv.org/html/2406.18665v3); [project page](https://sky.cs.berkeley.edu/project/routellm/). The percentages come from the project page and were not checked against the paper.
- Routers generalized to LLMs not present in training — [arXiv:2406.18665](https://arxiv.org/html/2406.18665v3)
- vLLM supports in-place reloading of updated adapter weights under the same name, which the docs connect to asynchronous RL — [vLLM docs](https://docs.vllm.ai/en/latest/features/lora.html)

### Inferences
- Adapter versioning and rollback are feasible on the serving side (same-name in-place reload, LRU or FIFO eviction, pinned slots in SGLang). Shadow and canary evaluation are not covered by these sources.

### Gaps
- Data selection, dedup, quality filtering, synthetic data from traces, active learning, drift detection, adapter registries, canary and shadow evaluation: not researched.

---

## 6. GPU requirements and unit economics

### Takeaway
GPU hourly prices for H100/H200/B200 vary widely by provider and tier. Spot and marketplace H100 is around $2–4/hr; hyperscalers and capacity blocks are higher. Training a LoRA on an 8B model is cheap on managed platforms (tens of dollars for a typical job, derived from per-token rates). Serving cost per 1M tokens depends on utilization, which none of the sources reported under a controlled setup.

### Cited Findings

**GPU prices (2026)**
- H100: specialist clouds and marketplaces roughly $2–4/GPU-hr; hyperscalers roughly $7–12/GPU-hr (one source) — [Spheron/tech-insider comparisons](https://tech-insider.org/aws-vs-azure-vs-google-cloud-gpu-pricing-2026). Spheron on-demand $2.64/hr; AWS p5 ~$6.88/GPU-hr in an 8-GPU instance, stamped 12 Oct 2026 — [Spheron H100 2026](https://www.spheron.network/blog/h100-price-per-hour-2026/)
- H100 on-demand median $3.92/GPU-hr (AIMultiple, November 2026 stamp) — [AIMultiple GPU index](https://aimultiple.com/gpu-index); Uvik median $4.20/hr for H100 SXM (October) — [Uvik GPU price index](https://uvik.net/blog/gpu-price-index/)
- H200 median $5.70 (Uvik, October) and $4.61 (AIMultiple, November); Lambda H200 on-demand $3.29 (Feb 2026); AWS raised H200 instance prices 15% in January 2026
- B200 median $8.19 (Uvik, October); Nebius on-demand $5.50/hr; Runpod $5.89/hr per GPU — vendor list prices
- Nebius raised H100 on-demand from $3.85 to $4.50/hr on 1 October 2026 — [Spheron/vendor news, secondary]

**Training cost (managed, per-token)**
- Tinker: Qwen3-8B train $0.44/1M tokens (stamp Oct 19 2026) — [Tinker pricing](https://thinkingmachines.ai/tinker/pricing/)
- Together: 8–9B SFT $0.34/1M training tokens (secondary, date unclear)
- **[derived]** Example: 10M dataset tokens × 3 epochs = 30M train tokens. At Tinker Qwen3-8B rate: 30 × $0.44 = **$13.20**. At Together 8–9B SFT rate: 30 × $0.34 = **$10.20**. Both exclude sampling/inference and storage
- **[derived]** Tinker checkpoint storage for a rank-16 all-linear 8B adapter (~84 MB bf16): 0.084 GB × $0.10/GB-month ≈ **$0.008/month**

**Training cost (self-hosted, GPU-hour based)**
- No sourced GPU-hours figure for LoRA on 7B/8B/32B/70B collected. The Vertex open-model doc gives no hardware spec for tuning.
- **[derived, illustrative]** For an 8B LoRA on one H100 at a rough 2,000 tokens/s training throughput (assumption, not sourced), 30M tokens ≈ 4.2 GPU-hours ≈ $11–17 at $2.64–$3.92/hr. Replace the throughput assumption with a measured value before use.

**Serving cost per 1M tokens (**[derived]**, formula)**
- $/1M tokens = (GPU $/hr) / (tokens/s × 3600) × 10^6. At $3.92/hr and an assumed 2,000 aggregate tokens/s: ≈ **$0.54/1M tokens**. Utilization and throughput dominate; no sourced throughput for multi-LoRA serving was found.
- Vendor-reported: Fireworks Llama 3.1 8B at $0.20/1M tokens, with LoRAs served at base-model price — [Fireworks](https://fireworks.ai/blog/multi-lora-serving)
- Multi-LoRA vs dedicated: the Fireworks claim is that one GPU set serves many adapters, so per-adapter marginal cost falls with adapter count until slot or memory limits bind. Unverified by independent benchmark.

**Storage per adapter (**[derived]**)**
- Rank 16 all-linear on Llama 3.1 8B: ≈ 42M params ≈ 84 MB bf16. Attention-only ≈ 27 MB. LoRAX guide cites 10–200 MB typical (third-party).

### Inferences
- Break-even between dedicated and multi-adapter serving depends on adapter count, traffic per adapter, and whether adapters sit idle. The sources provide no break-even model. I'd build one from the derived formula above with measured throughput.
- Training cost is small relative to serving cost at moderate traffic; the decision variable is recurring serving spend and data-collection effort, not the training run.

### Gaps
- Measured LoRA training time per 8B/32B/70B on H100/H200/B200: not sourced.
- Measured multi-LoRA serving throughput under tenant churn: not sourced.
- GPU price stamps for Q4 2026 are from aggregators, not provider price lists. Verify before budgeting.

---

## Decision framework: memory/context vs weight adaptation (derived from the evidence above)

Use external memory or context engineering when:
- Content is factual, changes over time, or must be cited (Ovadia; Gekhman). RAG outperformed unsupervised fine-tuning for new facts.
- The corpus is small enough for long context and retrieval is not the bottleneck (LongBench v2, ChatQA 2 show neither method dominates; test on your data).
- Traffic per tenant is low, so training and serving a dedicated adapter does not amortize.

Consider weight adaptation (LoRA/SFT/preference) when:
- The desired behavior is format, schema, tool-call syntax, style, or a procedure the base model gets wrong in a stable way. This is indicated by the literature, but I did not find a clean isolating study.
- Prompt or context length is a binding latency or token-budget constraint, and a stable behavior is repeated across many calls.
- The task requires an RL-style objective with a verifiable reward. LoRA matches full FT in RL even at rank 1 (TML), so adaptation is cheap here.
- Data is large enough to exceed the context budget but not to require full FT (TML: LoRA underperforms when the dataset exceeds its capacity, so size matters).

Warnings from the evidence:
- Do not teach new facts via fine-tuning when retrieval would do (Gekhman: slower learning, more hallucination).
- Attention-only LoRA underperforms; target MLP (and attention) layers.
- Per-user adapters: training cost scales with users; prefer per-tenant or per-app adapters unless personalization gain is measured (OPPU vs Profile-to-PEFT).
- Vendor serving claims (90% of base throughput, 100x cost, 200 ms adapter load) are not independently replicated in these sources.

---

## Source list (primary fetched unless marked)
- LoRA Without Regret: https://thinkingmachines.ai/blog/lora/ (fetched)
- Tinker pricing: https://thinkingmachines.ai/tinker/pricing/ (fetched, Oct 19 2026)
- OpenAI RFT billing: https://help.openai.com/en/articles/11323177-billing-guide-for-the-reinforcement-fine-tuning-api (fetched)
- OpenAI model optimization (wind-down): https://developers.openai.com/api/docs/guides/model-optimization (fetched)
- Vertex open-model tuning: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tuning/open-model-tuning (fetched)
- vLLM LoRA docs: https://docs.vllm.ai/en/latest/features/lora.html (fetched)
- SGLang LoRA docs: https://docs.sglang.io/advanced_features/lora.html (fetched)
- Fireworks multi-LoRA: https://fireworks.ai/blog/multi-lora-serving (fetched)
- LoRA arXiv:2106.09685, QLoRA arXiv:2305.14314, DoRA arXiv:2402.09353, DPO arXiv:2305.18290, Punica arXiv:2310.18547, Ovadia arXiv:2312.05934, Gekhman arXiv:2405.05904, Allen-Zhu arXiv:2404.05405, GRPO arXiv:2402.03300 (abstracts fetched)
- S-LoRA: https://sky.cs.berkeley.edu/project/s-lora/ ; https://arxiv.org/abs/2311.03285 (search summaries)
- Together fine-tuning pricing: https://docs.together.ai/docs/fine-tuning-pricing (search summary; rates from Together blog)
- Bedrock Claude 3 Haiku fine-tuning: https://www.anthropic.com/news/fine-tune-claude-3-haiku-ga ; https://aws.amazon.com/about-aws/whats-new/2024/11/fine-tuning-anthropics-claude-3-haiku-amazon-bedrock (search summaries)
- RouteLLM: https://arxiv.org/html/2406.18665v3 (search summary)
- OPPU: https://arxiv.org/abs/2402.04401 ; Profile-to-PEFT: https://arxiv.org/pdf/2510.16282 (search summaries)
- GPU price indices: https://aimultiple.com/gpu-index ; https://uvik.net/blog/gpu-price-index/ ; https://www.spheron.network/blog/h100-price-per-hour-2026/ (search summaries; aggregators, not provider price lists)
- LongBench v2 https://arxiv.org/pdf/2412.15204 ; ChatQA 2 https://arxiv.org/pdf/2407.14482 ; SagaScale https://arxiv.org/pdf/2601.09723 (search summaries)

## Consolidated gaps for the report writer
1. Controlled 2025–2026 head-to-head of long-context vs RAG vs fine-tuning, with cost.
2. DPO, GRPO, rsLoRA, LoRA+, VeRA equations and results: abstract-only or not fetched.
3. Independent hot-swap latency and adapters-per-GPU benchmarks across vLLM, SGLang, LoRAX, NVIDIA NIM / TensorRT-LLM, Modal.
4. Current official 2026 price pages for Vertex Gemini tuning, OpenAI SFT/DPO, Together, Fireworks, SageMaker, Predibase, Modal.
5. Measured LoRA training GPU-hours for 7B/8B/32B/70B.
6. Data curation, dedup, synthetic traces, active learning, drift detection, registries, canary and shadow evaluation.
7. Anthropic current fine-tuning availability (not found).
8. Gekhman and Ovadia numerical results (abstracts only).
