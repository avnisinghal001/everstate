import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Button, Tag } from "../components/ui";

const FLOW = [
  {
    icon: "message" as const,
    title: "Capture",
    copy: "Chat turns, tool calls and local agent sessions stream into BigQuery with user, team and agent scope.",
  },
  {
    icon: "sparkles" as const,
    title: "Consolidate",
    copy: "The dream cycle reads a lookback window, scrubs PII, deduplicates and asks Gemini for candidate beliefs.",
  },
  {
    icon: "shield" as const,
    title: "Review",
    copy: "Candidates land in a staged queue. A human commits, edits or discards them before they can be recalled.",
  },
  {
    icon: "database" as const,
    title: "Store",
    copy: "Committed rows live in Cloud Spanner, keyed by scope and category, with a full audit trail.",
  },
  {
    icon: "zap" as const,
    title: "Recall",
    copy: "Vector + keyword retrieval composes a compact context frame in under 10 ms, with no model call.",
  },
];

export function HowItWorksPage() {
  return (
    <main className="app-content reading" id="main-content" style={{ maxWidth: 900 }}>
      <header className="doc-hero">
        <div className="page-eyebrow"><Icon name="brain" size={13} /> Architecture</div>
        <h1>Memory that learns while your agents sleep.</h1>
        <p>
          Everstate is a scoped memory system for agent fleets. It separates the expensive work (understanding a session) from
          the cheap work (recalling a rule), so agents can stay fast without forgetting.
        </p>
        <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" icon="message" onClick={() => window.location.assign("/")}>Try the loop</Button>
          <Button icon="brain" onClick={() => window.location.assign("/studio")}>Inspect memory</Button>
          <Tag tone="success" dot>Cloud Run ready</Tag>
        </div>
      </header>

      <section className="doc-section" id="lifecycle">
        <h2>The lifecycle</h2>
        <p>
          Every rule has a provenance. Nothing is auto-committed just because a model said it. The loop has five deliberate
          stages, and each one is inspectable in the studio.
        </p>
        <div className="flow">
          {FLOW.map((step, index) => (
            <div key={step.title} style={{ display: "contents" }}>
              <div className="flow-node">
                <b><Icon name={step.icon} size={14} /> {step.title}</b>
                <span>{step.copy}</span>
                <span className="mono" style={{ marginTop: 8, color: "var(--accent-text)", fontSize: 10 }}>0{index + 1}</span>
              </div>
              {index < FLOW.length - 1 ? <div className="flow-arrow"><Icon name="arrowRight" size={16} /></div> : null}
            </div>
          ))}
        </div>
        <div className="doc-callout">
          <strong>Why staging matters:</strong> the dream cycle is allowed to be creative. The review gate is where the system
          becomes trustworthy. Contradictions are surfaced, not silently merged.
        </div>
      </section>

      <section className="doc-section" id="scopes">
        <h2>Four scopes, one recall</h2>
        <p>
          Memory is hierarchical: <span className="mono">ORG → TEAM → AGENT → USER</span>. A recall reads every scope the
          principal can see, then resolves conflicts using the category policy.
        </p>
        <div className="kpi-grid">
          <div className="kpi"><b>ORG</b><span>Shared invariants and company policy</span></div>
          <div className="kpi"><b>TEAM</b><span>Workflows and conventions owned by a team</span></div>
          <div className="kpi"><b>AGENT</b><span>Tool-specific behaviour and skills</span></div>
          <div className="kpi"><b>USER</b><span>Personal preferences and corrections</span></div>
        </div>
        <h3>Conflict resolution</h3>
        <ul>
          <li><strong>latest_wins</strong> — the most recent corroborated belief wins; older rows stay for audit.</li>
          <li><strong>highest_confidence</strong> — support count and extraction confidence decide.</li>
          <li><strong>scope_precedence</strong> — a narrower scope overrides a broader one.</li>
          <li><strong>manual_review</strong> — the conflict is staged and a human decides.</li>
        </ul>
      </section>

      <section className="doc-section" id="recall">
        <h2>Recall is a lookup, not a conversation</h2>
        <p>
          At question time, Everstate embeds the prompt, matches it against scoped memories, filters by category policy and
          composes a compact frame. If the match is strong enough, the agent answers from memory without a model round-trip.
        </p>
        <div className="code-block">{`POST /api/preference/query
{
  "user_id": "user:you@example.com",
  "session_id": "sess-8f2",
  "prompt": "Which package manager should I use?"
}

200 OK
{
  "source": "SPANNER_CACHE",
  "latency_ms": 7,
  "response": "Use uv. Never pip install globally.",
  "recalled_memories": [...]
}`}</div>
        <p style={{ marginTop: 12 }}>
          A miss is not a failure: the agent answers normally and the session is captured, so the next dream cycle can learn
          from the correction.
        </p>
      </section>

      <section className="doc-section" id="quality">
        <h2>Quality is measured, not claimed</h2>
        <p>
          The optimizer runs a seven-metric suite over stored and generated adversarial cases: recall accuracy, conflict
          resolution, guardrail compliance, hallucination rejection, scope conflict, deduplication and token savings.
        </p>
        <div className="kpi-grid">
          <div className="kpi"><b>7</b><span>quality metrics per run</span></div>
          <div className="kpi"><b>4</b><span>Matryoshka slices scored</span></div>
          <div className="kpi"><b>α</b><span>quality vs token weight</span></div>
          <div className="kpi"><b>↺</b><span>one-click rollback</span></div>
        </div>
        <h3>AlphaEvolve</h3>
        <p>
          Auto-tune mutates embedding dimensions, top-k, cosine thresholds and injection formats. Every candidate is scored;
          the best config per niche goes into a MAP-Elites archive. A champion is promoted only when you say so.
        </p>
      </section>

      <section className="doc-section" id="security">
        <h2>Security is part of the schema</h2>
        <ul>
          <li><strong>Auth</strong> — Firebase session cookies with an email allowlist; local-dev bypass is disabled on Cloud Run.</li>
          <li><strong>RBAC</strong> — principals, allowed scopes/actions, path prefixes and classification ceilings.</li>
          <li><strong>PII</strong> — scrubbing happens before extraction; the policy is visible in Ingest.</li>
          <li><strong>Audit</strong> — every write-back mutation can be rolled back from the Backend panel.</li>
        </ul>
      </section>

      <section className="doc-section" id="stack">
        <h2>The stack</h2>
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          {[
            ["Capture", "FastAPI · BigQuery · Firebase Auth"],
            ["Consolidation", "Gemini · ADK agents · PII scrubbing"],
            ["Storage", "Cloud Spanner · scoped rows · audit columns"],
            ["Recall", "Vector + keyword · Matryoshka slices"],
            ["Frontend", "Vite · React · TypeScript · portfolio tokens"],
            ["Deploy", "Cloud Run · Terraform · Docker"],
          ].map(([title, copy]) => (
            <div className="surface surface-pad" key={title}>
              <strong style={{ fontSize: "var(--text-subhead)" }}>{title}</strong>
              <p className="muted" style={{ fontSize: "var(--text-caption-1)", marginTop: 3 }}>{copy}</p>
            </div>
          ))}
        </div>
        <div className="doc-callout">
          <strong>Local development:</strong> run the API with <span className="mono">uv run uvicorn src.ui_service.server:api --reload --port 8080</span>,
          then the UI with <span className="mono">cd web && npm run dev</span>. Vite proxies <span className="mono">/api</span> to the
          backend.
        </div>
      </section>

      <section className="doc-section" id="next">
        <h2>Where to go next</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link to="/" className="btn btn-primary"><Icon name="message" size={16} /> Capture a session</Link>
          <Link to="/studio" className="btn btn-secondary"><Icon name="brain" size={16} /> Review memories</Link>
          <Link to="/studio?s=optimize" className="btn btn-secondary"><Icon name="wand" size={16} /> Run a benchmark</Link>
          <Link to="/studio?s=security" className="btn btn-ghost"><Icon name="shield" size={16} /> Simulate access</Link>
        </div>
      </section>
    </main>
  );
}
