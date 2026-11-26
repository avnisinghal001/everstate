import { useEffect, useState, type ReactNode } from "react";
import { Brain, type RegionKey } from "./art/Brain";
import { HeroScene } from "./art/HeroScene";
import { InfraScene } from "./art/InfraScene";
import { NatureBackdrop } from "./art/Nature";
import { Pictogram, type PictogramName } from "./art/Pictogram";

const REPO = "https://github.com/your-org/everstate";

function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
      { rootMargin: "0px 0px -6% 0px", threshold: 0.1 },
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    const nav = document.querySelector(".nav");
    const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", onScroll); };
  }, []);
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <path d="M13 2 23.4 8v10L13 24 2.6 18V8Z" fill="var(--fg)" />
      <path d="M13 2 23.4 8 13 14 2.6 8Z" fill="var(--clay)" />
      <path d="M13 14v10" stroke="var(--bg)" strokeWidth="1" opacity=".5" />
    </svg>
  );
}

function Head({ kicker, title, children, stack }: { kicker: string; title: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`sec-head reveal ${stack ? "stack" : ""}`}>
      <div><span className="kicker">{kicker}</span><h2>{title}</h2></div>
      {children && <p>{children}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ data */
const PRINCIPLES: Array<{ key: RegionKey; icon: PictogramName; title: string; brain: string; body: string }> = [
  { key: "hippocampus", icon: "session", title: "Capture fast, keep briefly", brain: "hippocampus",
    body: "Every session gets short-term working memory under its id. It's cheap to write and expires on its own." },
  { key: "sleep", icon: "dream", title: "Consolidate while idle", brain: "sleep",
    body: "When a session ends, a Dream cycle turns raw activity into proposed memories. Only evidence quoted verbatim survives." },
  { key: "neocortex", icon: "memory", title: "Store what lasts", brain: "neocortex",
    body: "Approved memories are versioned, scoped and searchable by meaning. New versions supersede old ones; nothing is overwritten." },
  { key: "prefrontal", icon: "rules", title: "Let rules govern behaviour", brain: "prefrontal cortex",
    body: "Organisation guardrails outrank team rules and personal preferences, and every override is explained." },
  { key: "plasticity", icon: "feedback", title: "Strengthen what helps", brain: "plasticity",
    body: "“That helped” and “that didn’t” update a per-memory utility, so useful memories rise and noise sinks." },
  { key: "forgetting", icon: "forget", title: "Forget on purpose", brain: "forgetting",
    body: "Working memory decays by TTL. Deletion removes a memory from storage, index and caches, with a receipt." },
];

const CODE: Record<string, ReactNode> = {
  Python: (
    <>
      <span className="k">from</span> everstate <span className="k">import</span> Everstate, Scope{"\n\n"}
      <span className="k">async with</span> Everstate.<span className="f">from_env</span>() <span className="k">as</span> es:{"\n"}
      {"    "}<span className="c"># awake: capture a session</span>{"\n"}
      {"    "}<span className="k">await</span> es.<span className="f">observe</span>(org, ada, <span className="s">"I don't eat meat. Mornings work best."</span>, session_id=<span className="s">"s-101"</span>){"\n\n"}
      {"    "}<span className="c"># asleep: grounded proposals, then a person promotes them</span>{"\n"}
      {"    "}dream = <span className="k">await</span> es.<span className="f">end_session</span>(org, ada, <span className="s">"s-101"</span>, target=me){"\n"}
      {"    "}<span className="k">await</span> es.<span className="f">promote</span>(org, ada, [p.id <span className="k">for</span> p <span className="k">in</span> dream.proposals]){"\n\n"}
      {"    "}<span className="c"># a week later, a different session</span>{"\n"}
      {"    "}hits = <span className="k">await</span> es.<span className="f">recall</span>(org, <span className="s">"plan a team lunch with Ada"</span>,{"\n"}
      {"                           "}scopes=es.<span className="f">scopes</span>(org=<span className="s">"acme"</span>, user=<span className="s">"ada"</span>)){"\n"}
      {"    "}prompt = hits.<span className="f">context_block</span>()   <span className="c"># + trace, scores, citations</span>
    </>
  ),
  HTTP: (
    <>
      <span className="c"># tenant and user come from the signed-in identity, never the body</span>{"\n"}
      <span className="k">POST</span> /api/v2/recall{"\n"}
      {"{"} <span className="s">"query"</span>: <span className="s">"plan a team lunch with Ada"</span>, <span className="s">"k"</span>: 5 {"}"}{"\n\n"}
      <span className="c">→ 200</span>{"\n"}
      {"{"} <span className="s">"memories"</span>: [{"{"} <span className="s">"content"</span>: <span className="s">"Ada is vegetarian."</span>,{"\n"}
      {"                 "}<span className="s">"score"</span>: 0.81, <span className="s">"components"</span>: {"{"} <span className="s">"similarity"</span>: 0.74, … {"}"} {"}"}],{"\n"}
      {"  "}<span className="s">"suppressed"</span>: [{"{"} <span className="s">"reason"</span>: <span className="s">"guardrail@org takes precedence"</span> {"}"}],{"\n"}
      {"  "}<span className="s">"latency_ms"</span>: 1.3, <span className="s">"trace"</span>: {"{"} <span className="s">"stages_ms"</span>: {"{"} … {"}"} {"}"} {"}"}
    </>
  ),
  Config: (
    <>
      <span className="c"># pick a profile, override any single port</span>{"\n"}
      EVERSTATE_PROFILE=<span className="s">gcp</span>          <span className="c"># Spanner + Vertex AI + BigQuery, Memorystore serving</span>{"\n"}
      EVERSTATE_INDEX=<span className="s">qdrant</span>          <span className="c"># or redis · spanner · pinecone · vertex_vector_search</span>{"\n"}
      EVERSTATE_EMBEDDER=<span className="s">vertex</span>       <span className="c"># gemini-embedding-001 · or ollama (EmbeddingGemma)</span>{"\n"}
      EVERSTATE_EMBED_DIMENSIONS=<span className="s">768</span>{"\n"}
      EVERSTATE_ADMINS=<span className="s">admin@acme.com</span>  <span className="c"># who may promote shared memories</span>
    </>
  ),
};

/* ------------------------------------------------------------------ page */
export default function App() {
  useReveal();
  const [region, setRegion] = useState<RegionKey>("sleep");
  const [tab, setTab] = useState("Python");
  const [copied, setCopied] = useState(false);

  return (
    <>
      <header className="nav">
        <div className="wrap nav-in">
          <a className="brand" href="#top"><Mark /><span className="brand-name">Everstate</span></a>
          <nav className="nav-links" aria-label="Sections">
            <a href="#product">Product</a><a href="#principles">Principles</a><a href="#uses">Use cases</a>
            <a href="#benchmarks">Benchmarks</a><a href="#infrastructure">Infrastructure</a><a href="#developers">Developers</a>
          </nav>
          <div className="nav-cta">
            <a className="btn btn-line btn-sm" href={REPO}>GitHub</a>
            <a className="btn btn-ink btn-sm" href="#developers">Start building</a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ---------------------------------------------------------- hero */}
        <section className="hero">
          <div className="wrap hero-top">
            <div>
            <span className="kicker"><b>●</b>&nbsp; Memory infrastructure for AI agents</span>
            <h1>Agents that remember what <em>matters</em>.</h1>
            <p className="lede">
              Everstate turns scattered conversations, documents and tool calls into memory your agents can trust:
              <strong> captured per session, consolidated while idle, governed by your rules,</strong> and recalled in
              about a millisecond, with the source of every answer.
            </p>
            <div className="hero-actions">
              <a className="btn btn-clay" href="#developers">Start building</a>
              <a className="btn btn-line" href="#principles">How it thinks</a>
              <span className="install">
                pip install everstate
                <button onClick={() => { navigator.clipboard?.writeText("pip install everstate"); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
                  {copied ? "copied" : "copy"}
                </button>
              </span>
            </div>
            </div>
            <div className="side-proof" aria-label="Measured results">
              <div><b>1.3 ms</b><span>median recall on Redis, 1k memories</span></div>
              <div><b>0.70</b><span>top-1 recall on reworded questions</span></div>
              <div><b>0 / 3</b><span>fabricated memories let through</span></div>
              <div><b>15+</b><span>adapters behind 7 interfaces</span></div>
            </div>
          </div>
          <div className="scene-wrap">
            <div className="scene-scroll" ref={(el) => { if (el && el.scrollWidth > el.clientWidth && el.scrollLeft === 0) el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.42; }}>
              <HeroScene />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- product, nature cards */}
        <section className="sec" id="product">
          <div className="wrap">
            <Head kicker="The product" title="Memory that behaves like memory.">
              Not a pile of embeddings. Memories have versions, owners, scopes and an expiry, and the system can
              tell you why it recalled each one.
            </Head>
            <div className="nature-grid">
              <article className="nature-card reveal">
                <div className="nature">
                  <NatureBackdrop variant="meadow" />
                  <div className="vignette stack-cards">
                    <div className="ui back"><div className="ui-row"><span className="strike">Ada writes services in Go</span><span className="pill">superseded</span></div></div>
                    <div className="ui mid"><div className="ui-row"><span className="strike">Ada works from Porto</span><span className="pill">replaced</span></div></div>
                    <div className="ui">
                      <div className="ui-row"><span className="k">user · ada</span><span className="pill now">current · v3</span></div>
                      <div className="ui-row" style={{ display: "block" }}>
                        <div style={{ fontSize: 15, fontWeight: 500 }}>Ada writes Rust for systems work</div>
                        <div style={{ color: "#6f6d66", marginTop: 4 }}>Learned in session s-117 · approved by Ada</div>
                      </div>
                      <div className="ui-row"><span className="k">provenance · 3 events</span><span className="pill">updated 2d ago</span></div>
                    </div>
                  </div>
                </div>
                <div><h3>Updates, not pile-ups</h3><p><b>Every change is a new version.</b> Old beliefs are kept for audit, never silently overwritten, and only the current one is recalled.</p></div>
              </article>

              <article className="nature-card reveal">
                <div className="nature">
                  <NatureBackdrop variant="coast" />
                  <div className="vignette ui">
                    <div className="ui-row"><span className="k">recall · “can I deploy on Friday?”</span></div>
                    <div className="ui-row"><span>Never deploy to production on Fridays</span><span className="pill win">org · wins</span></div>
                    <div className="ui-row"><span>Use uv to run the test suite</span><span className="pill">team</span></div>
                    <div className="ui-row"><span className="strike">Ada ships on Friday afternoons</span><span className="pill">user · suppressed</span></div>
                    <div className="ui-row" style={{ color: "#6f6d66" }}><span className="k">reason</span><span style={{ marginInlineStart: "auto" }}>guardrail@org takes precedence</span></div>
                  </div>
                </div>
                <div><h3>Rules that scope like your company</h3><p><b>Org ▸ team ▸ agent ▸ user ▸ session.</b> Guardrails flow down; preferences stay personal; conflicts resolve the same way every time.</p></div>
              </article>

              <article className="nature-card reveal">
                <div className="nature">
                  <NatureBackdrop variant="forest" />
                  <div className="vignette trace">
                    <div><span className="c">recall</span>(<span className="d">"plan a team lunch with Ada"</span>)</div>
                    {[["embed", 6], ["search", 62], ["hydrate", 18], ["score", 4], ["arbitrate", 4]].map(([s, w]) => (
                      <div className="bar-row" key={String(s)}><span className="d">{s}</span><i style={{ inlineSize: `${w}%` }} /><span>{(Number(w) / 70).toFixed(2)}</span></div>
                    ))}
                    <div style={{ marginTop: 10 }}><span className="c">→</span> 2 memories · 1 suppressed · <span className="c">1.3 ms</span></div>
                    <div className="d">diet 0.81 = 0.75·sim + 0.15·recency + 0.10·conf + 0.20·utility</div>
                  </div>
                </div>
                <div><h3>Every recall explains itself</h3><p><b>Scores, stage timings and suppressions</b> come back with each result, so relevance is debugged with numbers, not guesses.</p></div>
              </article>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- brain principles */}
        <section className="sec" id="principles">
          <div className="wrap">
            <Head kicker="First principles" title={<>Borrowed from the one system that already remembers well.</>}>
              Brains don’t store everything. They capture quickly, consolidate during sleep, keep what’s reinforced and
              let the rest fade. Everstate is built on the same division of labour.
            </Head>
            <div className="brain-grid">
              <div className="brain-art reveal"><Brain active={region} /></div>
              <div className="principles reveal" role="list">
                {PRINCIPLES.map((p) => (
                  <div key={p.key} role="listitem" tabIndex={0} className={`principle ${region === p.key ? "on" : ""}`}
                    onMouseEnter={() => setRegion(p.key)} onFocus={() => setRegion(p.key)}>
                    <Pictogram name={p.icon} />
                    <div><h4>{p.title}<span>{p.brain}</span></h4><p>{p.body}</p></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- use cases */}
        <section className="sec" id="uses">
          <div className="wrap">
            <Head kicker="Use cases" title="What teams build with Everstate." stack />
            <div className="uses">
              <article className="use big reveal">
                <Pictogram name="support" size={5} />
                <h3>Support agents that recognise people</h3>
                <p>Returning customers never repeat themselves. The assistant picks up where the last conversation ended, and forgets on request.</p>
                <div className="ui">
                  <div className="ui-row"><span className="k">customer · priya</span><span className="pill now">recalled</span></div>
                  <div className="ui-row" style={{ display: "block" }}>
                    <div style={{ color: "#6f6d66" }}>“Hi, it’s Priya again. My order still hasn’t arrived.”</div>
                    <div style={{ marginTop: 8 }}>The replacement for order #4821 from last Tuesday hasn’t shipped either. I’ve escalated it; you’ll hear back by 5 pm.</div>
                  </div>
                  <div className="ui-row"><span className="k">from session s-88 · 6 days ago</span></div>
                </div>
              </article>
              <article className="use reveal">
                <Pictogram name="code" size={5} />
                <h3>Coding agents with house rules</h3>
                <p>Conventions like “run tests with uv” and “never commit secrets” follow every agent into every repo.</p>
              </article>
              <article className="use reveal">
                <Pictogram name="company" size={5} />
                <h3>A company brain</h3>
                <p>Decisions and context from chats, docs and tickets, scoped by team and permissioned by default.</p>
              </article>
              <article className="use reveal">
                <Pictogram name="person" size={5} />
                <h3>Personal assistants that learn</h3>
                <p>Small preferences from past sessions quietly shape better answers, without anyone writing a profile.</p>
              </article>
              <article className="use reveal">
                <Pictogram name="rules" size={5} />
                <h3>Regulated teams</h3>
                <p>Provenance on every memory, approvals for shared ones, and deletion receipts for every “forget me”.</p>
              </article>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- benchmarks */}
        <section className="sec" id="benchmarks">
          <div className="wrap">
            <Head kicker="Benchmarks" title="Measured, not promised.">
              40 questions reworded so they share almost no words with the memory that answers them, hidden among 960
              look-alike memories. Reproduce it with <span className="mono">make bench-full</span>.
            </Head>
            <div className="bench">
              <div className="chart reveal">
                <h3>Finding the right memory</h3>
                <p className="sub">Top-1 recall on reworded questions, 1,000 memories (higher is better)</p>
                {[["EmbeddingGemma · Redis", 0.7, true], ["EmbeddingGemma · exact scan", 0.7, true], ["Keyword hashing (no model)", 0.15, false]].map(([l, v, c]) => (
                  <div className="hbar" key={String(l)}><span>{l}</span><div className="track"><div className={`fill ${c ? "clay" : ""}`} style={{ transform: `scaleX(${v})` }} /></div><span className="v">{Number(v).toFixed(2)}</span></div>
                ))}
                <p className="sub" style={{ marginTop: 18, marginBottom: 0 }}>Top-5 recall: 0.80 with EmbeddingGemma, 0.17 without a model.</p>
              </div>
              <div className="chart reveal">
                <h3>Staying fast as memory grows</h3>
                <p className="sub">Median retrieval time in milliseconds (lower is better, log scale)</p>
                {[["Redis · 1k memories", 1.4, true], ["Redis · 10k memories", 1.9, true], ["Exact scan · 1k", 28.2, false], ["Exact scan · 10k", 278.9, false]].map(([l, v, c]) => (
                  <div className="hbar" key={String(l)}><span>{l}</span><div className="track"><div className={`fill ${c ? "clay" : ""}`} style={{ transform: `scaleX(${Math.log10(Number(v) + 1) / Math.log10(300)})` }} /></div><span className="v">{Number(v).toFixed(1)}</span></div>
                ))}
                <p className="sub" style={{ marginTop: 18, marginBottom: 0 }}>10× more memories cost Redis +0.5 ms; a brute-force scan gets 10× slower.</p>
              </div>
            </div>
            <div className="gov">
              <div className="reveal"><b>0 of 3</b><span>fabricated memories accepted by the consolidation gate (4/4 grounded ones kept)</span></div>
              <div className="reveal"><b>3 of 3</b><span>scope conflicts resolved to the right rule</span></div>
              <div className="reveal"><b>98.5%</b><span>agreement between fast (HNSW) and exact search, top-5</span></div>
            </div>
            <p className="fine">
              MacBook (Apple silicon), Redis 8.10 vector sets, EmbeddingGemma via Ollama, 24 Nov 2026. Retrieval excludes
              embedding the question (about 85 ms on CPU). A synthetic workload; public long-memory benchmarks are next.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------- infrastructure */}
        <section className="sec" id="infrastructure">
          <div className="wrap">
            <Head kicker="Infrastructure" title="Native to Google Cloud. Portable everywhere else.">
              One engine, seven interfaces. In production, Spanner is the source of truth and Memorystore serves reads
              in about a millisecond. On a laptop, everything runs in Redis and Ollama.
            </Head>
            <div className="infra reveal"><InfraScene /></div>
            <div className="profiles">
              <div className="profile reveal"><code>profile = gcp</code><p>Spanner + ANN, BigQuery events, Vertex AI embeddings and Gemini, Memorystore as the serving tier.</p></div>
              <div className="profile reveal"><code>profile = redis</code><p>Redis 8 or Valkey serves everything: store, vector index, cache and event stream.</p></div>
              <div className="profile reveal"><code>profile = local</code><p>In-process with deterministic stand-ins. The full test suite runs with no cloud account.</p></div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- developers */}
        <section className="sec" id="developers">
          <div className="wrap dev">
            <div className="reveal">
              <span className="kicker">Developers</span>
              <h2 className="serif" style={{ margin: "14px 0 0", font: "400 clamp(2.1rem,4vw,3.2rem)/1.04 var(--font-serif)", letterSpacing: "-0.03em" }}>
                Seven interfaces. Laws enforced by tests.
              </h2>
              <p className="muted" style={{ marginTop: 16 }}>
                The engine depends only on interfaces; every database and model is an adapter you can swap or write yourself,
                then prove with the same contract tests the built-ins pass.
              </p>
              <ul className="laws">
                <li><span><b>Tenant isolation.</b> No read, write or delete crosses an organisation.</span></li>
                <li><span><b>No ungated writes.</b> Consolidation only proposes; people promote.</span></li>
                <li><span><b>Supersede, never overwrite.</b> History stays auditable.</span></li>
                <li><span><b>Deletion reaches everything.</b> Store, index and caches, with a receipt.</span></li>
                <li><span><b>Learning is bounded.</b> Feedback moves ranking through one reported term.</span></li>
              </ul>
            </div>
            <div className="code-win reveal">
              <div className="code-tabs" role="tablist">
                {Object.keys(CODE).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>
                ))}
              </div>
              <pre><code>{CODE[tab]}</code></pre>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- cta */}
        <div className="wrap">
          <section className="cta reveal">
            <NatureBackdrop variant="dawn" />
            <div className="cta-in">
              <h2>Give your agents a memory worth trusting.</h2>
              <p>Open-source core, Google Cloud native, and running on your laptop in one command.</p>
              <div className="hero-actions" style={{ justifyContent: "center" }}>
                <a className="btn btn-ink" href="#developers">Start building</a>
                <a className="btn btn-line" href={REPO}>Read the docs</a>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer>
        <div className="wrap foot">
          <a className="brand" href="#top"><Mark /><span className="brand-name">Everstate</span></a>
          <span>Memory infrastructure for AI agents · © 2026</span>
        </div>
      </footer>
    </>
  );
}
