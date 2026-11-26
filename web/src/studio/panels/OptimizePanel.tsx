import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useResource } from "../../lib/hooks";
import { useToast, useWorkspace } from "../../app/Providers";
import { asArray, firstString, formatNumber, formatPercent, prettyJson, statusTone, titleCase, truncate } from "../../lib/utils";
import type { EvalCase, EvolveResult, Scorecard } from "../../lib/types";
import { Icon } from "../../components/Icon";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Segmented,
  Select,
  Spinner,
  Stat,
  Tag,
  Textarea,
} from "../../components/ui";
import { DetailRow, ErrorNote, JsonView, type PanelProps } from "../shared";

type OptimizeTab = "benchmarks" | "autotune" | "sync";

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = value <= 1 ? value * 100 : value;
  return (
    <div className="score-row">
      <span className="muted" style={{ fontSize: "var(--text-subhead)" }}>{label}</span>
      <span className="score-track">
        <span className="score-fill" style={{ inlineSize: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
      <span className="num">{pct.toFixed(1)}%</span>
    </div>
  );
}

function metricLabel(key: string): string {
  return titleCase(key.replace(/_/g, " "));
}

export function OptimizePanel({ state }: PanelProps) {
  const [tab, setTab] = useState<OptimizeTab>("benchmarks");
  const { toast } = useToast();
  const { scopes } = useWorkspace();

  const casesResource = useResource(() => api.studio.evalCases(), []);
  const archiveResource = useResource(() => api.studio.evolveArchive(), []);
  const syncResource = useResource(() => api.studio.syncStatus(), []);

  const [alpha, setAlpha] = useState(0.65);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const [genTopic, setGenTopic] = useState("cloud data science");
  const [genCount, setGenCount] = useState(4);
  const [genBusy, setGenBusy] = useState(false);

  const [generations, setGenerations] = useState(3);
  const [candidates, setCandidates] = useState(2);
  const [evolveAlpha, setEvolveAlpha] = useState(0.65);
  const [evolveBusy, setEvolveBusy] = useState(false);
  const [evolveResult, setEvolveResult] = useState<EvolveResult | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [scenario, setScenario] = useState({
    prompt: "Which package manager should I use for this repo?",
    expected_fact: "uv",
    dimensions: 768,
    format: "FULL_BELIEF",
    threshold: 0.6,
  });
  const [scenarioResult, setScenarioResult] = useState<Record<string, unknown> | null>(null);
  const [scenarioBusy, setScenarioBusy] = useState(false);

  const runScenario = async () => {
    setScenarioBusy(true);
    try {
      const data = await api.studio.retest({
        prompt: scenario.prompt,
        expected_fact: scenario.expected_fact,
        user_id: scopes.user_id,
        team_id: scopes.team_id,
        agent_id: scopes.agent_id,
        org_id: scopes.org_id,
        embedding_dimensions: scenario.dimensions,
        injection_format: scenario.format,
        cosine_threshold: scenario.threshold,
      });
      setScenarioResult(data);
      toast("success", "Scenario retested", `${data.triggered_count ?? 0} memories triggered.`);
    } catch (cause) {
      toast("error", "Scenario retest failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setScenarioBusy(false);
    }
  };

  const cases = asArray(casesResource.data?.cases);
  const activeConfig = state.active_config ?? {};
  const metrics = scorecard?.scorecard?.metrics ?? {};
  const champion = evolveResult?.champion ?? archiveResource.data?.champion;

  const archiveCells = useMemo(() => {
    return asArray(evolveResult?.archive_summary?.cells ?? archiveResource.data?.archive_summary?.cells);
  }, [evolveResult, archiveResource.data]);

  const runEval = async () => {
    setEvalBusy(true);
    try {
      const data = await api.studio.runEval({ alpha_quality_weight: alpha });
      setScorecard(data);
      toast("success", "Benchmark complete", `Pareto ${Number(data.pareto_fitness ?? data.scorecard?.pareto_fitness ?? 0).toFixed(3)}`);
    } catch (cause) {
      toast("error", "Benchmark failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setEvalBusy(false);
    }
  };

  const generateCases = async () => {
    setGenBusy(true);
    try {
      await api.studio.generateEval({ topic: genTopic, count: genCount });
      toast("success", "Adversarial cases generated");
      await casesResource.refresh();
    } catch (cause) {
      toast("error", "Generation failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setGenBusy(false);
    }
  };

  const runEvolve = async () => {
    setEvolveBusy(true);
    try {
      const data = await api.studio.evolve({
        generations,
        candidates_per_generation: candidates,
        alpha_quality_weight: evolveAlpha,
      });
      setEvolveResult(data);
      toast("success", "Auto-tune complete", `${data.archive_summary?.populated_cells ?? 0} archive cells populated.`);
    } catch (cause) {
      toast("error", "Auto-tune failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setEvolveBusy(false);
    }
  };

  const promote = async (configId?: string) => {
    try {
      await api.studio.promoteChampion(configId ? { config_id: configId } : {});
      toast("success", "Champion promoted", "The active recall config has been updated.");
      await archiveResource.refresh();
    } catch (cause) {
      toast("error", "Promotion failed", cause instanceof Error ? cause.message : undefined);
    }
  };

  const resetSandbox = async () => {
    setResetBusy(true);
    try {
      await api.studio.reset({ scope_type: "USER", scope_id: scopes.user_id, clear_eval_cases: true });
      toast("success", "Sandbox reset", "Scoped memories and eval cases were cleared.");
      setConfirmReset(false);
    } catch (cause) {
      toast("error", "Reset failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <Segmented
          ariaLabel="Optimize mode"
          value={tab}
          onChange={setTab}
          options={[
            { value: "benchmarks", label: "Benchmarks", icon: "chart" },
            { value: "autotune", label: "Auto-tune", icon: "wand" },
            { value: "sync", label: "Sync", icon: "refresh" },
          ]}
        />
        <div className="row" style={{ gap: 6 }}>
          <Tag tone="accent">α {alpha.toFixed(2)}</Tag>
          <Tag>{String(activeConfig.embedding_dimensions ?? 768)}d</Tag>
          <Tag>{asArray(cases).length} test cases</Tag>
        </div>
      </div>

      {tab === "benchmarks" ? (
        <>
          <div className="grid grid-rail">
            <div className="surface">
              <div className="surface-head">
                <div>
                  <h3>Recall benchmark</h3>
                  <p>Seven quality metrics plus Matryoshka slices and token savings.</p>
                </div>
                <Button variant="primary" icon="play" onClick={runEval} loading={evalBusy}>Run suite</Button>
              </div>
              <div className="surface-body stack">
                <div className="row-between" style={{ gap: 12 }}>
                  <div>
                    <div className="field-label">Quality weight α</div>
                    <p className="field-hint">Higher α favours accuracy; lower α favours token efficiency.</p>
                  </div>
                  <strong className="mono">{alpha.toFixed(2)}</strong>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={alpha}
                  onChange={(event) => setAlpha(Number(event.target.value))}
                  aria-label="Quality weight"
                />
                {scorecard ? (
                  <div className="stack">
                    <div className="grid grid-3">
                      <Stat label="Pareto fitness" value={formatNumber(Number(scorecard.pareto_fitness ?? scorecard.scorecard?.pareto_fitness ?? 0).toFixed(3))} accent icon="chart" />
                      <Stat label="Quality" value={formatPercent(Number(scorecard.quality_score ?? scorecard.scorecard?.quality_score ?? 0), 1)} icon="checkCircle" />
                      <Stat label="Token efficiency" value={formatPercent(Number(scorecard.token_efficiency_score ?? scorecard.scorecard?.token_efficiency_score ?? 0), 1)} icon="zap" />
                    </div>
                    <div className="stack" style={{ gap: 7 }}>
                      {Object.entries(metrics).map(([key, value]) => (
                        <ScoreBar key={key} label={metricLabel(key)} value={Number(value)} />
                      ))}
                    </div>
                    <details>
                      <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--text-subhead)" }}>Full scorecard</summary>
                      <JsonView value={scorecard} />
                    </details>
                  </div>
                ) : (
                  <Banner>
                    <Icon name="info" size={16} />
                    Run the suite to see the Pareto score, per-metric accuracy and Matryoshka slice comparison.
                  </Banner>
                )}
              </div>
            </div>

            <div className="surface rail-card">
              <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Active config</span>
              <div>
                <DetailRow label="Dimensions">{String(activeConfig.embedding_dimensions ?? "—")}</DetailRow>
                <DetailRow label="Top-k">{String(activeConfig.top_k ?? activeConfig.max_results ?? "—")}</DetailRow>
                <DetailRow label="Cosine">{String(activeConfig.cosine_threshold ?? activeConfig.min_cosine_similarity ?? "—")}</DetailRow>
                <DetailRow label="Injection">{String(activeConfig.injection_format ?? "—")}</DetailRow>
                <DetailRow label="Quality α">{String(activeConfig.alpha_quality_weight ?? "—")}</DetailRow>
              </div>
              <Button size="sm" icon="wand" onClick={() => setTab("autotune")}>Tune this config</Button>
            </div>
          </div>

          <div className="surface">
            <div className="surface-head">
              <div>
                <h3>Test cases</h3>
                <p>Adversarial contradictions, scope conflicts, hallucinations and updates.</p>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Input value={genTopic} onChange={(event) => setGenTopic(event.target.value)} placeholder="Topic" style={{ width: 160 }} />
                <Input type="number" min={1} max={12} value={genCount} onChange={(event) => setGenCount(Number(event.target.value))} style={{ width: 70 }} />
                <Button size="sm" icon="sparkles" onClick={generateCases} loading={genBusy}>Generate</Button>
                <Button size="sm" variant="ghost" icon="refresh" onClick={() => void casesResource.refresh()} loading={casesResource.loading}>Refresh</Button>
              </div>
            </div>
            <ErrorNote error={casesResource.error} />
            {casesResource.loading && cases.length === 0 ? (
              <Spinner label="Loading cases" />
            ) : cases.length === 0 ? (
              <EmptyState icon="test" title="No test cases yet" copy="Generate adversarial cases or rate a session to seed the suite." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Prompt</th>
                      <th>Expected fact</th>
                      <th style={{ width: 110 }}>Category</th>
                      <th style={{ width: 100 }}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((testCase: EvalCase, index) => (
                      <tr key={firstString(testCase.case_id, testCase.id, index)}>
                        <td style={{ maxWidth: 360 }}>{truncate(firstString(testCase.prompt, testCase.question, "—"), 160)}</td>
                        <td className="muted" style={{ maxWidth: 280 }}>{truncate(firstString(testCase.expected_fact, testCase.expected, "—"), 140)}</td>
                        <td><Tag>{titleCase(testCase.category ?? testCase.failure_tag ?? "general")}</Tag></td>
                        <td className="muted">{titleCase(testCase.source ?? "live")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="surface">
            <div className="surface-head">
              <div>
                <h3>Scenario retest</h3>
                <p>Run a prompt through live retrieval and inspect the exact context frame, latency and token savings.</p>
              </div>
              <Button variant="primary" icon="play" onClick={runScenario} loading={scenarioBusy}>Retest</Button>
            </div>
            <div className="surface-body stack">
              <div className="form-grid">
                <Field label="Prompt" className="span-2">
                  <Textarea value={scenario.prompt} onChange={(event) => setScenario({ ...scenario, prompt: event.target.value })} />
                </Field>
                <Field label="Expected fact">
                  <Input value={scenario.expected_fact} onChange={(event) => setScenario({ ...scenario, expected_fact: event.target.value })} />
                </Field>
                <Field label="Dimensions">
                  <Select value={scenario.dimensions} onChange={(event) => setScenario({ ...scenario, dimensions: Number(event.target.value) })}>
                    {[128, 256, 512, 768].map((dim) => <option key={dim} value={dim}>{dim}d</option>)}
                  </Select>
                </Field>
                <Field label="Injection format">
                  <Select value={scenario.format} onChange={(event) => setScenario({ ...scenario, format: event.target.value })}>
                    <option value="FULL_BELIEF">Full belief</option>
                    <option value="COMPACT_BULLET">Compact bullet</option>
                    <option value="ATOMIC_KV">Atomic key/value</option>
                  </Select>
                </Field>
                <Field label="Cosine threshold">
                  <Input type="number" min="0.1" max="1" step="0.01" value={scenario.threshold} onChange={(event) => setScenario({ ...scenario, threshold: Number(event.target.value) })} />
                </Field>
              </div>
              {scenarioResult ? (
                <div className="stack">
                  <div className="grid grid-4">
                    <Stat label="Latency" value={`${Number(scenarioResult.latency_ms ?? 0).toFixed(1)}ms`} icon="timer" />
                    <Stat label="Triggered" value={formatNumber(scenarioResult.triggered_count ?? 0)} icon="zap" />
                    <Stat label="Suppressed" value={formatNumber(scenarioResult.suppressed_count ?? 0)} icon="filter" />
                    <Stat label="Expected fact" value={scenarioResult.expected_fact_matched ? "Matched" : "Missed"} icon={scenarioResult.expected_fact_matched ? "checkCircle" : "alert"} />
                  </div>
                  <div>
                    <div className="field-label" style={{ marginBottom: 4 }}>Formatted context</div>
                    <pre className="code-block" style={{ maxHeight: 220, margin: 0 }}>{firstString(scenarioResult.formatted_context, "(empty)")}</pre>
                  </div>
                  <details>
                    <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--text-subhead)" }}>Token telemetry</summary>
                    <JsonView value={scenarioResult.token_telemetry ?? {}} />
                  </details>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : tab === "autotune" ? (
        <>
          <div className="grid grid-rail">
            <div className="surface">
              <div className="surface-head">
                <div>
                  <h3>AlphaEvolve auto-tune</h3>
                  <p>Search the recall configuration space and keep a quality-diversity archive.</p>
                </div>
                <Button variant="primary" icon="wand" onClick={runEvolve} loading={evolveBusy}>Start evolution</Button>
              </div>
              <div className="surface-body stack">
                <div className="form-grid">
                  <Field label="Generations">
                    <Input type="number" min={1} max={10} value={generations} onChange={(event) => setGenerations(Number(event.target.value))} />
                  </Field>
                  <Field label="Candidates / generation">
                    <Input type="number" min={1} max={6} value={candidates} onChange={(event) => setCandidates(Number(event.target.value))} />
                  </Field>
                  <Field label="Quality weight α" className="span-2">
                    <input className="range" type="range" min="0" max="1" step="0.05" value={evolveAlpha} onChange={(event) => setEvolveAlpha(Number(event.target.value))} aria-label="Evolution quality weight" />
                    <span className="field-hint">{evolveAlpha.toFixed(2)} · {evolveAlpha > 0.5 ? "accuracy-first" : "efficiency-first"}</span>
                  </Field>
                </div>
                {evolveResult ? (
                  <div className="grid grid-3">
                    <Stat label="Champion fitness" value={formatNumber(Number(champion?.pareto_fitness ?? 0).toFixed(3))} accent icon="trophy" />
                    <Stat label="Archive cells" value={formatNumber(evolveResult.archive_summary?.populated_cells ?? 0)} icon="grid" />
                    <Stat label="Dimensions" value={String((champion?.config as Record<string, unknown> | undefined)?.embedding_dimensions ?? "—")} icon="cpu" />
                  </div>
                ) : (
                  <Banner>
                    <Icon name="info" size={16} />
                    Evolution mutates dimensions, top-k, thresholds and injection formats, then scores every candidate against the suite.
                  </Banner>
                )}
              </div>
            </div>
            <div className="surface rail-card">
              <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Champion</span>
              {champion ? (
                <>
                  <div>
                    <DetailRow label="Fitness">{formatNumber(Number(champion.pareto_fitness ?? 0).toFixed(3))}</DetailRow>
                    <DetailRow label="Config id">{firstString((champion.config as Record<string, unknown> | undefined)?.config_id, "—")}</DetailRow>
                    <DetailRow label="Dimensions">{String((champion.config as Record<string, unknown> | undefined)?.embedding_dimensions ?? "—")}</DetailRow>
                    <DetailRow label="Top-k">{String((champion.config as Record<string, unknown> | undefined)?.top_k ?? "—")}</DetailRow>
                  </div>
                  <Button size="sm" variant="primary" icon="rocket" onClick={() => promote()}>Promote champion</Button>
                </>
              ) : (
                <p className="muted" style={{ fontSize: "var(--text-subhead)", lineHeight: 1.5 }}>
                  No champion yet. Run an evolution pass or load the archive.
                </p>
              )}
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => void archiveResource.refresh()} loading={archiveResource.loading}>Load archive</Button>
            </div>
          </div>

          <div className="surface">
            <div className="surface-head">
              <div>
                <h3>Quality-diversity archive</h3>
                <p>Each cell is the best config found for a quality/efficiency niche.</p>
              </div>
              <Tag tone="accent">{archiveCells.length} populated</Tag>
            </div>
            {archiveCells.length === 0 ? (
              <EmptyState icon="grid" title="Archive is empty" copy="Run auto-tune to populate the MAP-Elites grid." />
            ) : (
              <div className="archive-grid">
                {archiveCells.map((cell, index) => {
                  const config = (cell.config ?? {}) as Record<string, unknown>;
                  return (
                    <button key={firstString(cell.niche, index)} className="archive-cell" onClick={() => promote(firstString(config.config_id, undefined))}>
                      <span className="mono" style={{ fontSize: 10, color: "var(--fg-muted)" }}>{truncate(firstString(cell.niche, "niche"), 22)}</span>
                      <b>{formatNumber(Number(cell.pareto_fitness ?? cell.fitness ?? 0).toFixed(3))}</b>
                      <span className="muted" style={{ fontSize: 10 }}>{String(config.embedding_dimensions ?? "—")}d · top {String(config.top_k ?? "—")}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-rail">
            <div className="surface">
              <div className="surface-head">
                <div>
                  <h3>Spanner sync</h3>
                  <p>Push staged memories to the live preference store.</p>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Button icon="refresh" onClick={() => void syncResource.refresh()} loading={syncResource.loading}>Check</Button>
                  <Button variant="primary" icon="upload" onClick={async () => {
                    try {
                      await api.studio.syncPush(scopes);
                      toast("success", "Sync pushed");
                      await syncResource.refresh();
                    } catch (cause) {
                      toast("error", "Sync failed", cause instanceof Error ? cause.message : undefined);
                    }
                  }}>Push to Spanner</Button>
                </div>
              </div>
              <div className="surface-body">
                <ErrorNote error={syncResource.error} />
                {syncResource.loading && !syncResource.data ? <Spinner label="Checking sync" /> : (
                  <div className="stack">
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <Tag tone={statusTone(syncResource.data?.status ?? "OK")}>{firstString(syncResource.data?.status, "ready")}</Tag>
                      <Tag>{firstString(syncResource.data?.pending_count, "0")} pending</Tag>
                      <Tag>{firstString(syncResource.data?.last_sync_at, "never")}</Tag>
                    </div>
                    <JsonView value={syncResource.data ?? {}} />
                  </div>
                )}
              </div>
            </div>

            <div className="surface rail-card">
              <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Sandbox</span>
              <p className="muted" style={{ fontSize: "var(--text-subhead)", lineHeight: 1.5 }}>
                Reset the active user scope and clear evaluation cases to start from zero.
              </p>
              <Button size="sm" variant="danger" icon="rotate" onClick={() => setConfirmReset(true)}>Reset sandbox</Button>
              <Button size="sm" icon="copy" onClick={async () => {
                await navigator.clipboard.writeText(prettyJson(state));
                toast("success", "State copied");
              }}>Copy state</Button>
            </div>
          </div>

          <div className="surface">
            <div className="surface-head">
              <div>
                <h3>Sync contract</h3>
                <p>What moves from the workbench to the live store.</p>
              </div>
            </div>
            <div className="surface-body">
              <div className="flow">
                <div className="flow-node"><b><Icon name="brain" size={14} /> Memory tree</b><span>Staged edits and candidates</span></div>
                <div className="flow-arrow"><Icon name="arrowRight" size={16} /></div>
                <div className="flow-node"><b><Icon name="shield" size={14} /> Review gate</b><span>Human approval and conflict check</span></div>
                <div className="flow-arrow"><Icon name="arrowRight" size={16} /></div>
                <div className="flow-node"><b><Icon name="database" size={14} /> Spanner</b><span>Scoped preference rows</span></div>
                <div className="flow-arrow"><Icon name="arrowRight" size={16} /></div>
                <div className="flow-node"><b><Icon name="zap" size={14} /> Recall</b><span>Sub-10ms context injection</span></div>
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset the sandbox?"
        copy={`This deletes memories in ${scopes.user_id} and clears evaluation cases. Other scopes are untouched.`}
        confirmLabel="Reset"
        destructive
        busy={resetBusy}
        onConfirm={resetSandbox}
      />

      {evolveBusy ? (
        <div className="banner">
          <span className="spinner" style={{ width: 14, height: 14 }} />
          Evolution is running — {generations} generations × {candidates} candidates.
        </div>
      ) : null}
    </div>
  );
}
