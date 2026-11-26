# Continual Learning for LLMs: State of the Art (2024–2026), Research Notes

Date of research: 2026-11-24. Emphasis on 2026 work. Each source carries a date and a status tag: **[peer-reviewed venue]** (accepted at a named conference, with the venue cited), **[preprint]** (arXiv/OpenReview only, as far as checked), or **[blog]**.

**Method caveat:** Pages were read through a WebFetch summarizer, not as raw PDFs. Equations and numbers below come from those summaries or from search snippets and must be checked against the full PDFs before they are used in a product or publication. Where a figure comes from a search snippet and not a fetched page, it is marked "(snippet)".

---

## 0. Source-verification results (read first)

Two of the four user-specified sources do not match the titles or topics the brief assumed. Their content is reported below under what it actually is.

- **arXiv 2609.26457 is not the SLEEP paper.** It is "Recursive self-improvement of AI research agents" (Srikanth, Zhao, Xu, Wu, Jiang; cs.AI, submitted 22 Sep 2026). It is about an agent that edits its own code (AIDE²), not about parametric memory. Source: https://arxiv.org/abs/2609.26457 [preprint]
- **The SLEEP paper is arXiv 2606.03979.** Title: "Language Models Need Sleep: Learning to Self-Modify and Consolidate Memories" (Behrouz, Hashemi, Javanmard, Mirrokni; cs.LG). v1 submitted 2 Jun 2026, v2 revised 10 Jul 2026. The abstract says a version has been on OpenReview since Sep 2025. Source: https://arxiv.org/abs/2606.03979 [preprint]. The Google Research blog post links to this ID; it is dated 27 Oct 2026 on the page as summarized. Source: https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/ [blog]
- **arXiv 2609.14858 is not a continual-learning paper.** It is "Dream-RSI: Recursive Self-Improvement through Evolving Worlds" (Zheng et al., Univ. of Maryland, Google DeepMind, UVA; cs.CL; submitted 14 Sep 2026). It is about exploration policies for LLM coding-agent discovery loops, with a replay simulator built from recorded search history. Source: https://arxiv.org/html/2609.14858v1 [preprint]
- **The Anthropic page is about recursive self-improvement in general, not continual learning.** It contains no original publication date (it shows "Update 9/18/2026") and no mention of weight-level continual learning, memory, or forgetting. Source: https://www.anthropic.com/institute/recursive-self-improvement [blog/policy]

Each affected source is covered below under its actual content, and the relevant answer to the brief's question is given in §1.

---

## 1. Key question 1: The four specified sources

### 1a. SLEEP framework (Google Research blog + arXiv 2606.03979)

**Takeaway.** SLEEP is a two-phase training paradigm for deployed LLMs: wake (short-term storage in fast memory) and sleep (consolidation into slow parameters through "memory consolidation" and "dreaming"). The blog reports strong qualitative results but few numbers, no equations on the page, and no compute figures. Treat it as an early, unreplicated proof of concept (the abstract itself calls the distillation a "proof of concept").

**Cited findings**
- Problem framing: deployed LLMs have a fixed knowledge cutoff; parameter updates cause catastrophic forgetting, and in-context learning is lost when the session ends. — [Google Research blog](https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/) [blog]; [arXiv 2606.03979](https://arxiv.org/abs/2606.03979) [preprint]
- Method, as described: a wake phase stores temporary info in fast memory. A sleep phase has (i) **memory consolidation** — parameter expansion (new low-rank MoE experts added to lower-frequency memory blocks so older parameters aren't overwritten; the page names the "Hope" architecture), knowledge seeding by generalized knowledge distillation with on-policy distillation plus an RL "learning to imitate" (LTI) reward (semantic similarity + Levenshtein distance on student prefix completions of teacher text), and synaptic pruning (high-frequency temporary parameters reset after consolidation); and (ii) **dreaming** — the MoE router randomly activates non-standard experts to generate synthetic samples; gradient-based data selection keeps the best ones; SFT on top-rated samples, accepted only if downstream performance improves. — [blog](https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/) [blog]; abstract of [arXiv 2606.03979](https://arxiv.org/abs/2606.03979) [preprint] describes the same two stages ("Knowledge Seeding" via Generalized Distillation; "Dreaming" via RL-generated curriculum).
- Reported results per the blog (no baseline numbers except as noted): factual knowledge on SQuAD 48.9% (single-task) and 46.2% (continued pre-training); math AIME 24 79.2%, AIME 25 69.0%, HMMT 25 46.1%, stated to beat SFT, GRPO, and OPSD (baseline scores not given). Continual translation to unseen languages (Manchu, Kalamang): "near-zero performance drop" vs severe forgetting for ICL, Cartridges, and SFT (no figures). BABILong long-context: "near-perfect scaling" to 10M tokens, claimed above GPT-4 and Titans (no figures). — [blog](https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/) [blog]
- The arXiv abstract says experiments cover long-horizon tasks, continual learning, knowledge incorporation, and few-shot generalization, but gives no numbers. — [arXiv 2606.03979](https://arxiv.org/abs/2606.03979) [preprint]
- Compute: not reported in either source.

**Inferences**
- The mechanisms are a combination of established parts: on-policy distillation (the same family as RL's Razor, §3), growing MoE capacity to avoid overwriting (the same family as LoRA/O-LoRA isolation, §3), and self-generated replay (the same family as generative replay, §2). The novel claim is the scheduling of these into wake/sleep phases, and that is the part the sources do not quantify.
- Internal tension to resolve: the blog says the framework "operates entirely within a fixed model architecture," yet it also adds experts during sleep. This is a gap, not a contradiction that can be resolved from the summary.

**Gaps**
- No equations, loss functions, or regularizer terms are visible in either fetched source. The full PDF is needed for the objective, LTI reward weights, and the pruning schedule.
- No baseline numbers for the headline comparisons (SFT, GRPO, OPSD, Titans); no seeds or variance; no compute or wall-clock cost for a sleep phase.
- Venue status is unclear: OpenReview since Sep 2025 per the abstract, with no confirmed acceptance found.

**Relevance to a memory/consolidation product.** High conceptual fit (explicit wake/sleep split, self-generated data, selective pruning). But the claims are unverified, and the method requires training access (distillation and RL), so it is not directly usable by an API-only product without a self-hosted model.

### 1b. arXiv 2609.26457 (requested as "SLEEP"; actual content: AIDE² recursive self-improvement)

**Takeaway.** This paper is about agents that improve their own research code, not about parametric memory. It is relevant to the brief only as evidence for agent-level self-modification, including "memory mechanisms for compressing and managing context" discovered by the loop.

**Cited findings**
- Title and authors: "Recursive self-improvement of AI research agents," Srikanth et al., cs.AI, submitted 22 Sep 2026. — [arXiv 2609.26457](https://arxiv.org/abs/2609.26457) [preprint]
- Method: AIDE² proposes changes to its own code, benchmarks modified versions on AI R&D tasks, and keeps the best performers on hidden evaluations; an autonomous 8-day run produced seven successive improvements, including a new search policy and memory mechanisms for compressing and managing context. — [arXiv 2609.26457](https://arxiv.org/abs/2609.26457) [preprint]
- Transfer: gains held on four held-out benchmarks, including an out-of-distribution physics-based weather-forecasting task; the strongest discovered agent matches or exceeds a human-engineered production agent on all four. — [arXiv 2609.26457](https://arxiv.org/abs/2609.26457) [preprint]
- Reward hacking on a separate task family falls from 55% to 32% during the run, per the page summary. — [arXiv 2609.26457](https://arxiv.org/abs/2609.26457) [preprint]
- No equations, objectives, or regularizers were visible in the summary. Compute cost is not stated beyond the 8-day run. No limitations section was found in the summary.

**Inferences**
- For a memory product, the relevant takeaway is that a self-modifying loop discovered a context-compression and memory-management mechanism. This is an agent-scaffold result, not a weight-level consolidation result.

**Gaps**
- The full paper (28 pages per the summary) is needed for the limitations and cost details. The summary's reward-hacking numbers (55%→32%) should be checked.

### 1c. arXiv 2609.14858 (Dream-RSI; not continual learning)

**Takeaway.** Dream-RSI makes long-horizon LLM discovery cheaper by evaluating exploration policies offline on a replay simulator built from completed search histories, then redeploying the best policy. It is an optimization-of-search paper, not a parametric-memory paper.

**Cited findings**
- Objective per policy m on tree i: V_i^m = max_{v∈T_i^{m,k*}} s_v − β₁·N_i^m + β₂·N_i^m / max{1, k_i^{m,*}}, i.e., discovery quality minus an execution-cost term plus a parallelism bonus; averaged over the history. Policy selection: π_{t+1} = π_t^{m*} with m* = argmax_m V^m, so the selected policy is never worse than the current one on the fixed history. — [arXiv 2609.14858](https://arxiv.org/html/2609.14858v1) [preprint]
- Results (per summary): Lasso path, Gemini-3.7-Flash backbone, 1,879 discovery-agent calls vs 3,200 for recursive-fixed (average runtime 2,350.6 ms vs 2,516.7 ms); Gemini-3.1-Pro, 317 vs 550 calls. Math: SimpleTES was best on autocorrelation (1.453675 vs Dream-RSI 1.456375, lower is better). KernelBench: 2.43× fewer generations at comparable VGG16 performance; 2.09× higher ConvDiv score under similar budget. — [arXiv 2609.14858](https://arxiv.org/html/2609.14858v1) [preprint]
- Cost metric counts discovery-agent calls only; policy-development and replay overhead are excluded per the summary. — [arXiv 2609.14858](https://arxiv.org/html/2609.14858v1) [preprint]

**Inferences**
- The replay-simulator idea (evaluate a policy offline against recorded histories before deploying) is transferable to memory systems as a way to A/B consolidation policies without online risk. It is an inference, not something the paper tests.

**Gaps**
- The baselines use different backbones (SimpleTES on gpt-oss-120b; Dream-RSI on Gemini), so cross-paper comparisons are weak. The summary covered 100,000 of 107,996 characters; the last ~8k were not read.

### 1d. Anthropic, "recursive self-improvement" page

**Takeaway.** Anthropic's page argues that AI is taking a growing share of AI development and that full recursive self-improvement is neither reached nor inevitable. It gives throughput metrics, not a continual-learning method.

**Cited findings**
- Code output: engineers merged about 8× as much code per day in Q2 2026 as in 2024; more than 80% of merged code was authored by Claude (May 2026). — [Anthropic](https://www.anthropic.com/institute/recursive-self-improvement) [blog/policy]
- METR task-length doubling roughly every four months (previously seven); Opus 4.6 about 12 hours of reliable work; Mythos Preview at least 16 hours. — [Anthropic](https://www.anthropic.com/institute/recursive-self-improvement) [blog/policy] (cites METR; METR's own page was not fetched)
- Optimization speedup on a fixed training-code task about 52× (Mythos Preview, Apr 2026) vs about 4× for a skilled human in 4–8 hours. The page itself notes this depends on how much room the starting code leaves. — [Anthropic](https://www.anthropic.com/institute/recursive-self-improvement) [blog/policy]
- Stated limitations: lines of code overstates gains; self-reported uplift (median ~4×, March 2026 survey of 130 staff) is likely inflated; research-agent results did not transfer cleanly to production-scale models; humans chose problems and scoring. — [Anthropic](https://www.anthropic.com/institute/recursive-self-improvement) [blog/policy]
- No continual-learning or memory discussion beyond a speculative line about future models being "continuously improved by Claude itself." — [Anthropic](https://www.anthropic.com/institute/recursive-self-improvement) [blog/policy]

**Gaps**
- Anthropic does not publish a method for weight-level continual learning on this page. No compute or training-cost data for any claim. Date: only "Update 9/18/2026" is shown.

---

## 2. Key question 2: Architectures and test-time learning

### Titans (Behrouz, Zhong, Mirrokni; Google)
**Takeaway.** Titans makes a neural long-term memory that is written at test time by gradient steps on an associative-memory loss, with a surprise-based gate and a decay term for forgetting. It is peer-reviewed (NeurIPS 2025 poster).

**Cited findings**
- Surprise = gradient of the associative memory loss with respect to the input; the memory writes unexpected inputs more strongly; a decay term weighs memory size against surprise. Attention is the short-term memory; the neural memory is the long-term store; three integration variants (memory-as-context, memory-as-layer, memory-as-gated-branch). Outperforms Transformers at equal context and is competitive with full-context Transformers, scaling beyond 2M tokens. — [arXiv 2501.00663](https://arxiv.org/abs/2501.00663) [preprint, arXiv Dec 2024]; [NeurIPS 2025 poster](https://neurips.cc/virtual/2025/poster/119639) [peer-reviewed venue]
- From the paper (not re-verified this session): the memory update is of the form S_t = η_t S_{t−1} − θ_t ∇ℓ(M_{t−1}; x_t), M_t = (1 − α_t) M_{t−1} + S_t, i.e., a momentum-SGD write with weight decay α_t as the forgetting term. Check the exact form in the PDF before citing.

**Inferences.** The write rule is an online, per-token gradient step with decay; it is the closest published analogue to "memory consolidation by surprise" and is the base case for HOPE and SLEEP.

**Gaps.** Compute and throughput costs were not fetched. No 2026 independent replication found.

### Nested Learning and HOPE (Google, 2025; no 2026 follow-up found)
**Takeaway.** Nested Learning treats a model as nested optimization problems with different update frequencies (a "continuum memory system"), and HOPE is a self-modifying recurrent variant built from Titans-style blocks. The core claims are the authors' own; the only 2026 item found is an opinion post.

**Cited findings**
- Paper submitted to arXiv 31 Dec 2025 (arXiv 2512.24695). The Google Research blog is dated 7 Nov 2025 and states the paper appears at NeurIPS 2025. — [arXiv 2512.24695](https://arxiv.org/pdf/2512.24695v1) [peer-reviewed venue per blog]; [Google Research blog](https://research.google/blog/introducing-nested-learning-a-new-ml-paradigm-for-continual-learning/) [blog]
- HOPE: lower perplexity and higher accuracy than modern recurrent models and standard transformers on language modeling and common-sense reasoning (authors' claim; no independent replication found in the search). — [Google Research blog](https://research.google/blog/introducing-nested-learning-a-new-ml-paradigm-for-continual-learning/) [blog]
- The Medium post "Nested Learning Changes the Game for Continual AI" describes itself as a follow-up, but it is opinion and links the work to HRM/TRM small recursive models. — [Medium](https://medium.com/@m.mastrodonato/nested-learning-changes-the-game-for-continual-ai-8cfe44060ef6) [opinion]

**Gaps.** No 2026 paper found that extends HOPE with independent benchmarks. Search was one query only; a second pass on OpenReview 2026 is recommended.

### ATLAS, TTT layers, fast weights
- **TTT layers** (Sun et al., "Learning to (Learn at Test Time)," arXiv 2407.04620, v4 Aug 2025): the hidden state is itself a model trained by gradient steps on each test sequence. TTT-Linear and TTT-MLP outperform Transformers and Mamba from 125M to 1.3B; TTT-Linear is faster than Transformer at 8k context per the authors. — [arXiv 2407.04620](https://arxiv.org/abs/2407.04620) [preprint; venue not confirmed in this session]
- **ATLAS** (arXiv 2505.23735): prefers "test-time memorization" over "test-time training"; the memory is updated by a surprise-style metric on the current input. Numbers not fetched. — [arXiv 2505.23735](https://arxiv.org/pdf/2505.23735) [preprint]
- **2026 follow-ups found (snippets only, not fetched):** SR-TTT, arXiv 2603.06642, routes high-surprisal tokens to an external sparse memory buffer instead of the recurrent state. — [arXiv 2603.06642](https://arxiv.org/abs/2603.06642) [preprint]; Mela, arXiv 2605.10537, test-time memory consolidation with gradient-as-surprise. — [arXiv 2605.10537](https://arxiv.org/pdf/2605.10537) [preprint]; MemoPilot, arXiv 2606.08656, trains the memory-update process for a frozen LLM with RL. — [arXiv 2606.08656](https://arxiv.org/pdf/2606.08656) [preprint]. These are useful leads; none was read in full.

### Memory layers and external memory
- **MemoryLLM** (arXiv 2402.04624): fixed pool of memory tokens per layer; self-update replaces only a fraction of tokens, so old knowledge fades slowly; recall degrades beyond about 20k tokens of injected info. — [arXiv 2402.04624](https://arxiv.org/html/2402.04624v2) [preprint]
- **M+** (arXiv 2502.00592, ICML 2025 poster): adds a CPU-resident long-term store with a co-trained retriever, one retrieval per layer for all query heads; the authors report retention extended from under 20k to over 160k tokens at similar GPU memory (authors' claim, not independently verified). — [arXiv 2502.00592](https://arxiv.org/html/2502.00592v2) [preprint]; [ICML 2025](https://icml.cc/virtual/2025/poster/45431) [peer-reviewed venue]

**Gaps.** Memory-layer scaling (the Meta memory-layers line of work) was not searched.

---

## 3. Key question 3: Knowledge editing, consolidation, and self-distillation

### Knowledge editing
- **AlphaEdit** (ICLR 2025 oral, arXiv 2410.02355): projects each sequential edit onto the null space of preserved knowledge before applying it; the authors report a 36.7% average improvement over the best baselines by adding one line to MEMIT; models LLaMA3, GPT2-XL, GPT-J. — [ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/hash/29c8c615b3187ee995029284702d3f43-Abstract-Conference.html) [peer-reviewed venue]; [arXiv 2410.02355](https://arxiv.org/html/2410.02355v4) [preprint]
- **ROME / MEMIT** (rank-one and mass edits to MLP weights): not fetched in this session. Cited from memory as arXiv 2202.05262 (ROME) and arXiv 2210.07229 (MEMIT); verify before use.
- **Scaling limits:** the sources above establish that sequential edits degrade the model (the reason for null-space projection). Quantitative breakdown points as the number of edits grows were not found in the sources read.

**Gaps.** No 2026 knowledge-editing benchmark was retrieved. Edit-count limits and side effects on unrelated knowledge are open in this research pass.

### Self-edits and self-distillation (SEAL)
- **SEAL** (Zweiger, Pari et al.; arXiv 2506.10943; NeurIPS 2025): the model generates "self-edits" (restructured data, hyperparameters, tool calls) and is trained with RL, using the downstream performance of the SFT-updated model as reward. Reported results (snippet): ARC few-shot with Llama-3.2-1B success 72.5% vs 20% for self-edits without RL training and 0% for in-context learning; oracle TTT 100%. Knowledge incorporation generalizes to continued pretraining. — [arXiv 2506.10943](https://arxiv.org/abs/2506.10943) [preprint]; [NeurIPS 2025](https://neurips.cc/virtual/2025/poster/118690) [peer-reviewed venue]
- **Compute:** the outer RL loop requires an inner SFT per candidate edit. Cost was not retrieved.

### Consolidation, sleep, and replay
- The SLEEP framework (§1a) and the SuRe paper (surprise-driven prioritized replay for continual LLM learning, arXiv 2511.22367) are the two 2025–2026 sources on offline consolidation. — [arXiv 2511.22367](https://arxiv.org/pdf/2511.22367) [preprint, snippet only]
- Complementary learning systems (CLS) theory as applied to LLMs: no source was retrieved in this pass. **Gap.**
- Reconsolidation on recall: no source retrieved. **Gap.**

---

## 4. Key question 4: Forgetting mitigation

### Replay, regularization, isolation

- **LoRA learns less and forgets less** (Biderman et al., Databricks Mosaic AI; arXiv 2405.09673; ICLR 2025 poster). LoRA underperforms full fine-tuning on learning (more so for code than math), but forgets less of the base model's capabilities outside the target domain. The authors read this as a regularization effect stronger than weight decay or dropout. Full fine-tuning learns perturbations of rank 10–100× higher than typical LoRA. Follow-up: "LoRA vs Full Fine-tuning: An Illusion of Equivalence" (arXiv 2410.21228) reports the same forgetting pattern when fit is matched, but says it is not a guarantee. — [arXiv 2405.09673](https://arxiv.org/abs/2405.09673v2) [peer-reviewed venue: ICLR 2025 — https://iclr.cc/virtual/2025/poster/31465]; [arXiv 2410.21228](https://arxiv.org/pdf/2410.21228) [preprint]
- **O-LoRA** (Wang et al.; arXiv 2310.14152; EMNLP 2023 Findings): each task gets a LoRA in a subspace kept orthogonal to earlier tasks via a penalty on squared inner products of the A (down-projection) matrices; earlier LoRAs are frozen; no replay data needed. — [arXiv 2310.14152](https://arxiv.org/abs/2310.14152v1) [peer-reviewed venue: EMNLP 2023 Findings — https://aclanthology.org/2023.findings-emnlp.715]. Follow-up OPLoRA (arXiv 2510.13003) projects against dominant singular directions of frozen weights. [preprint]
- **EWC and regularization:** the TRACE repository implements EWC, OGD, GEM, and O-LoRA as baselines (https://github.com/BeyonderXX/TRACE). Quantitative EWC results on LLMs were not retrieved.
- **Replay:** MLLM-CTBench (arXiv 2508.08275) reports that replay helps weaker models much more than stronger ones and that results vary with task order. — [arXiv 2508.08275](https://arxiv.org/html/2508.08275v2) [preprint, snippet]. A quantization study (arXiv 2512.18934, snippet) reports 8-bit models retaining earlier tasks better than FP16 under replay. [preprint, snippet]

### Model merging
- TIES (trim, elect sign, disjoint mean) and DARE (random drop with 1/(1−p) rescale), used with task arithmetic. In a 2026 study of continual post-training (arXiv 2605.09608, snippet), TIES was usually the strongest of TA/TIES/DARE in non-continual baselines and DARE scored notably lower on several benchmarks at 8B. — [arXiv 2605.09608](https://arxiv.org/pdf/2605.09608) [preprint, snippet]
- A separate benchmark (arXiv 2511.21437, snippet) concludes that model merging methods mostly fail on LLMs. — [arXiv 2511.21437](https://www.arxiv.org/pdf/2511.21437) [preprint, snippet]
- Merging avoids interference from sequential fine-tuning, a point argued in "MeMo: Memory as a Model" (arXiv 2605.15156, snippet). [preprint]

### RL vs SFT forgetting
- **RL's Razor** (Shenfeld, Pari, Agrawal; arXiv 2509.04259; ICLR 2026): among solutions that fit a new task, on-policy RL prefers the one with smallest KL to the base model; forgetting tracks the KL shift measured on the new task. Comparison at matched task accuracy: GRPO and REINFORCE-style on-policy methods reach the same performance at a much smaller KL than SFT and SimPO. — [arXiv 2509.04259](https://arxiv.org/abs/2509.04259) [preprint]; [ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/618c95f4557c15b253fb0e6f548ea0c0-Abstract-Conference.html) [peer-reviewed venue]
- **RL Forgets! / CPO** (Luo et al.; arXiv 2607.04364, submitted 5 Jul 2026, v4 5 Nov 2026): argues standard RL does forget under continual post-training of multimodal reasoning models. The objective mismatch: KL regularization is measured on current-task data, but forgetting comes from drift on prior-task distributions. Proposes CPO, a replay-free prior-task behavioral KL with a local Fisher surrogate. The fetched abstract reports no numbers. — [arXiv 2607.04364](https://arxiv.org/pdf/2607.04364) [preprint]
- **Conflict to note:** a search snippet attributed to this paper the claim that the GRPO KL constraint "fails to reduce forgetting and hurts plasticity." The fetched abstract does not contain that claim; it describes a mismatch in where the KL is measured. Do not cite the snippet version.

### Forgetting beyond parametric knowledge (2026)
- CapTrack (arXiv 2603.06610, snippet): large study across legal and medical domains, models up to 80B; forgetting extends beyond parametric knowledge; no universal mitigation; a stability-plasticity tradeoff in which reducing forgetting sacrifices post-training gains. [preprint, snippet]
- TRACE finding: llama2-chat 13B GSM8K accuracy fell from 28.8% to 2% after training on TRACE tasks. — [arXiv 2310.06762](https://arxiv.org/abs/2310.06762v1) [preprint; venue not confirmed this session]

---

## 5. Key question 5: Benchmarks and metrics

| Benchmark | Source | Date | What it tests | Status |
|---|---|---|---|---|
| TRACE | [arXiv 2310.06762](https://arxiv.org/abs/2310.06762v1) | Oct 2023 | 8 tasks (C-STANCE, FOMC, MeetingBank, Py150, ScienceQA, NumGLUE-cm, NumGLUE-ds, 20Minuten) on aligned LLMs; general ability and instruction-following loss | preprint (venue not confirmed) |
| MLLM-CTBench | [arXiv 2508.08275](https://arxiv.org/html/2508.08275v2) | 2025 | 8 CL algorithms on multimodal LLMs; task-order sensitivity | preprint |
| MRCL | [arXiv 2607.04364](https://arxiv.org/pdf/2607.04364) | Jul 2026 | Multimodal reasoning continual RL | preprint |
| MedCL-Bench | [arXiv 2603.16738](https://arxiv.org/html/2603.16738) | Mar 2026 | 10 biomedical NLP datasets as a CL suite; naive FT, regularization, rehearsal | preprint |
| CapTrack | [arXiv 2603.06610](https://arxiv.org/pdf/2603.06610) | Mar 2026 | Post-training forgetting in legal and medical domains, up to 80B | preprint |
| CurLL | [arXiv 2510.13008](https://arxiv.org/pdf/2510.13008) | Oct 2025 | Developmental CL evaluation (title only; not read) | preprint |

**Survey:** Chen et al., "Beyond Static Models: An Evolving Framework for Continual Learning in LLMs across Training Stages," arXiv 2603.12658 (13 Mar 2026; v2 9 Aug 2026). Taxonomy: rehearsal, regularization, and architecture-based methods, organized by training stage (continual pre-training, continual fine-tuning, continual alignment). It lists forgetting rate and knowledge-transfer efficiency as metrics. — [arXiv 2603.12658](https://arxiv.org/abs/2603.12658) [preprint]

**Metrics.** Forgetting, backward transfer, forward transfer, and plasticity are named across sources above; the survey lists forgetting rate and knowledge-transfer efficiency. Exact formulas (e.g., the GEM-style BWT/FWT definitions) were not verified in this session. **Gap.**

**Not searched (gaps):** TemporalWiki, EvolvingQA, CKL, and any 2026 knowledge-update benchmark beyond those listed above. These were named in the brief and need a dedicated pass.

---

## 6. Compute costs and limitations (cross-cutting)

- **Compute is the largest gap.** No source above reported a GPU-hour or dollar cost for a sleep, distillation, or self-edit cycle, except Anthropic's research-agent run (800 agent-hours, roughly $18k compute, per the Anthropic page) — which is an agent loop, not weight training. — [Anthropic](https://www.anthropic.com/institute/recursive-self-improvement) [blog/policy]
- **Benchmarks disagree on the winner.** Replay, on-policy RL, and merging each win in some settings and fail in others (see the 2026 snippets above). No single method dominates; CapTrack and MLLM-CTBench both report this explicitly.
- **Most 2026 results are preprints** reviewed through summaries. Peer-reviewed items are the 2025 ICLR/NeurIPS/EMNLP papers listed above.

---

## 7. Implications for a memory/consolidation product (inferences)

1. **Cheapest path with evidence:** external memory plus periodic consolidation (MemoryLLM/M+-style retrieval, or summary-to-store) avoids weight edits. This is supported by the M+ retention numbers (authors' claim) and by the forgetting results that show weight updates are the main source of interference.
2. **If weights must change,** prefer on-policy data (RL's Razor; CPO replay-free KL) over SFT on fixed corpora, and prefer low-rank adapters per task (O-LoRA, LoRA's lower forgetting) with a replay or KL anchor.
3. **Surprise-gated writes** (Titans, SR-TTT, Mela) are the most direct published analogues of "store what was unexpected," but no 2026 independent benchmark of them was found.
4. **Do not rely on SLEEP's headline numbers** until the PDF is read: the blog gives no baselines or compute for most claims.

---

## Source list (all URLs used)

- https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/ [blog, 27 Oct 2026 per summary]
- https://arxiv.org/abs/2606.03979 [preprint, Jun/Jul 2026]
- https://arxiv.org/abs/2609.26457 [preprint, 22 Sep 2026]
- https://arxiv.org/html/2609.14858v1 [preprint, 14 Sep 2026]
- https://www.anthropic.com/institute/recursive-self-improvement [blog/policy, Update 18 Sep 2026]
- https://arxiv.org/abs/2501.00663 [Titans, preprint] and https://neurips.cc/virtual/2025/poster/119639 [NeurIPS 2025]
- https://arxiv.org/pdf/2512.24695v1 [Nested Learning, Dec 2025]; https://research.google/blog/introducing-nested-learning-a-new-ml-paradigm-for-continual-learning/ [blog, 7 Nov 2025]
- https://medium.com/@m.mastrodonato/nested-learning-changes-the-game-for-continual-ai-8cfe44060ef6 [opinion]
- https://arxiv.org/abs/2407.04620 [TTT layers]
- https://arxiv.org/pdf/2505.23735 [ATLAS]
- https://arxiv.org/abs/2603.06642 [SR-TTT, 2026]; https://arxiv.org/pdf/2605.10537 [Mela, 2026]; https://arxiv.org/pdf/2606.08656 [MemoPilot, 2026]
- https://arxiv.org/html/2402.04624v2 [MemoryLLM]; https://arxiv.org/html/2502.00592v2 [M+]; https://icml.cc/virtual/2025/poster/45431 [ICML 2025]
- https://proceedings.iclr.cc/paper_files/paper/2025/hash/29c8c615b3187ee995029284702d3f43-Abstract-Conference.html [AlphaEdit, ICLR 2025]; https://arxiv.org/html/2410.02355v4
- https://arxiv.org/abs/2506.10943 [SEAL]; https://neurips.cc/virtual/2025/poster/118690 [NeurIPS 2025]
- https://arxiv.org/pdf/2511.22367 [SuRe]
- https://arxiv.org/abs/2405.09673v2 [LoRA learns less]; https://iclr.cc/virtual/2025/poster/31465; https://arxiv.org/pdf/2410.21228 [LoRA illusion of equivalence]
- https://arxiv.org/abs/2310.14152v1 [O-LoRA]; https://aclanthology.org/2023.findings-emnlp.715; https://arxiv.org/pdf/2510.13003v1 [OPLoRA]
- https://arxiv.org/html/2508.08275v2 [MLLM-CTBench]; https://arxiv.org/pdf/2512.18934.pdf [quantization study]
- https://arxiv.org/pdf/2605.09608 [geometry conflict]; https://arxiv.org/abs/2511.21437 [merging benchmark]; https://arxiv.org/pdf/2605.15156 [MeMo]
- https://arxiv.org/abs/2509.04259 [RL's Razor]; https://proceedings.iclr.cc/paper_files/paper/2026/hash/618c95f4557c15b253fb0e6f548ea0c0-Abstract-Conference.html [ICLR 2026]
- https://arxiv.org/pdf/2607.04364 [RL Forgets / CPO / MRCL]
- https://arxiv.org/pdf/2603.06610 [CapTrack]; https://arxiv.org/html/2603.16738 [MedCL-Bench]
- https://arxiv.org/abs/2310.06762v1 [TRACE]; https://github.com/BeyonderXX/TRACE
- https://arxiv.org/abs/2603.12658 [survey, 2026]
- https://arxiv.org/pdf/2510.13008 [CurLL]
- https://arxiv.org/pdf/2609.32499 and https://arxiv.org/pdf/2605.25525 (SAE-FD) were surfaced by search and not read; excluded from the claims above.

## Requested-but-not-completed items

- Full read of the SLEEP PDF (equations, baselines, compute): not done; only the blog and abstract were read.
- ROME/MEMIT primary-source read and 2026 knowledge-editing benchmarks: not done.
- CLS theory, generative replay, reconsolidation, context distillation as LLM work: not retrieved.
- TemporalWiki, EvolvingQA, CKL: not retrieved.
- Quantitative EWC-on-LLM results: not retrieved.
