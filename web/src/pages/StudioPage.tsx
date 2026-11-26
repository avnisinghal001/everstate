import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useResource } from "../lib/hooks";
import { useToast } from "../app/Providers";
import { asArray, formatNumber } from "../lib/utils";
import type { StudioState } from "../lib/types";
import { Icon, type IconName } from "../components/Icon";
import { Button, PageHeader, Spinner, Tag } from "../components/ui";
import { ErrorNote, type PanelProps } from "../studio/shared";
import { MemoriesPanel } from "../studio/panels/MemoriesPanel";
import { SessionsPanel } from "../studio/panels/SessionsPanel";
import { OptimizePanel } from "../studio/panels/OptimizePanel";
import { JobsPanel } from "../studio/panels/JobsPanel";
import { EntitiesPanel, CategoriesPanel, IngestPanel, ExtractorsPanel, BackendPanel, SecurityPanel } from "../studio/panels/OpsPanels";

export type StudioSection =
  | "memories"
  | "sessions"
  | "optimize"
  | "jobs"
  | "entities"
  | "categories"
  | "ingest"
  | "extractors"
  | "backend"
  | "security";

const SECTIONS: Array<{ value: StudioSection; label: string; icon: IconName; group: string; copy: string }> = [
  { value: "memories", label: "Memories", icon: "brain", group: "Workspace", copy: "The scoped memory tree and review queue" },
  { value: "sessions", label: "Sessions", icon: "messages", group: "Workspace", copy: "Transcripts, summaries and helpfulness" },
  { value: "optimize", label: "Optimize", icon: "wand", group: "Workspace", copy: "Benchmarks, auto-tune and sync" },
  { value: "jobs", label: "Jobs", icon: "activity", group: "Workspace", copy: "Background pipelines and progress" },
  { value: "entities", label: "Entities", icon: "users", group: "Configure", copy: "Org, team, agent and user scope hierarchy" },
  { value: "categories", label: "Categories", icon: "tag", group: "Configure", copy: "Taxonomy, retention and trigger policy" },
  { value: "ingest", label: "Ingest", icon: "upload", group: "Configure", copy: "Sources, PII policy and live telemetry" },
  { value: "extractors", label: "Extractors", icon: "cpu", group: "Configure", copy: "Prompt co-design and extraction runs" },
  { value: "backend", label: "Backend", icon: "database", group: "Configure", copy: "Write-back targets and audit trail" },
  { value: "security", label: "Security", icon: "shield", group: "Configure", copy: "RBAC policies, PII and simulations" },
];

function isSection(value: string | null): value is StudioSection {
  return SECTIONS.some((section) => section.value === value);
}

export function StudioPage() {
  const [params] = useSearchParams();
  const raw = params.get("s");
  const section: StudioSection = isSection(raw) ? raw : "memories";
  const [showRaw, setShowRaw] = useState(false);
  const { toast } = useToast();

  const resource = useResource<StudioState>(() => api.studio.state(), []);
  const jobs = useResource(() => api.studio.jobs({ limit: 50 }), []);

  const state = resource.data ?? {};
  const counts = useMemo(() => {
    const tree = state.tree ?? {};
    const memoryCount =
      ["ORG", "TEAM", "AGENT", "USER"].reduce((total, scope) => total + asArray(tree[scope as keyof typeof tree]).length, 0) ||
      asArray(state.files).length;
    return {
      memories: memoryCount,
      staged: asArray(state.staged_commits).length,
      sessions: asArray(state.sessions).length,
      categories: asArray(state.categories).length,
      entities: asArray(state.entities).length,
      extractors: asArray(state.extractors).length,
      policies: asArray(state.security_policies).length,
      jobs: asArray(jobs.data?.jobs).filter((job) => ["RUNNING", "QUEUED"].includes(String(job.status).toUpperCase())).length,
    };
  }, [state, jobs.data]);

  const panelProps: PanelProps = {
    state,
    refresh: async () => {
      await resource.refresh();
      toast("success", "Workspace refreshed");
    },
  };

  const meta = SECTIONS.find((item) => item.value === section)!;

  return (
    <main className="app-content wide" id="main-content">
      <PageHeader
        eyebrow={<><Icon name="brain" size={13} /> Enterprise memory studio</>}
        title="The memory bank, in the open."
        lede="Every rule is scoped, sourced, evaluated and reversible. Review what the agents learned, tune how it is recalled, and audit every write."
        actions={
          <>
            <Button icon="refresh" onClick={() => void resource.refresh()} loading={resource.loading}>
              Refresh
            </Button>
            <Button icon="codeFile" onClick={() => setShowRaw((prev) => !prev)}>
              {showRaw ? "Hide JSON" : "Inspect JSON"}
            </Button>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <StatCard icon="brain" label="Memories" value={formatNumber(counts.memories)} meta={`${counts.staged} awaiting review`} />
        <StatCard icon="messages" label="Sessions" value={formatNumber(counts.sessions)} meta="captured transcripts" />
        <StatCard icon="activity" label="Active jobs" value={formatNumber(counts.jobs)} meta="running or queued" />
        <StatCard icon="shield" label="Policies" value={formatNumber(counts.policies)} meta={`${counts.categories} categories`} />
      </div>

      <div className="studio-panel">
        <div className="row-between" style={{ gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 className="section-title">{meta.label}</h2>
            <p className="section-copy">{meta.copy}</p>
          </div>
          {section !== "memories" ? (
            <Tag tone="accent">
              <Icon name={meta.icon} size={12} /> {section}
            </Tag>
          ) : (
            <Tag tone={counts.staged > 0 ? "warning" : "success"} dot>
              {counts.staged > 0 ? `${counts.staged} staged` : "all synced"}
            </Tag>
          )}
        </div>

        <ErrorNote error={resource.error} />

        {resource.loading && !resource.data ? (
          <div className="surface">
            <Spinner label="Loading workspace" />
          </div>
        ) : (
          <>
            {section === "memories" ? <MemoriesPanel {...panelProps} /> : null}
            {section === "sessions" ? <SessionsPanel {...panelProps} /> : null}
            {section === "optimize" ? <OptimizePanel {...panelProps} /> : null}
            {section === "jobs" ? <JobsPanel {...panelProps} /> : null}
            {section === "entities" ? <EntitiesPanel {...panelProps} /> : null}
            {section === "categories" ? <CategoriesPanel {...panelProps} /> : null}
            {section === "ingest" ? <IngestPanel {...panelProps} /> : null}
            {section === "extractors" ? <ExtractorsPanel {...panelProps} /> : null}
            {section === "backend" ? <BackendPanel {...panelProps} /> : null}
            {section === "security" ? <SecurityPanel {...panelProps} /> : null}
          </>
        )}

        {showRaw ? (
          <div className="surface">
            <div className="surface-head">
              <div>
                <h3>Bootstrap snapshot</h3>
                <p>GET /api/studio/state — the single source of truth for every workspace.</p>
              </div>
              <Button
                size="sm"
                icon="copy"
                onClick={async () => {
                  await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
                  toast("success", "Snapshot copied");
                }}
              >
                Copy
              </Button>
            </div>
            <pre className="code-block" style={{ maxHeight: 520, margin: 0, borderRadius: 0 }}>
              {JSON.stringify(state, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function StatCard({ icon, label, value, meta }: { icon: IconName; label: string; value: string; meta: string }) {
  return (
    <div className="stat stat-accent">
      <span className="stat-label">
        <Icon name={icon} size={14} />
        {label}
      </span>
      <span className="stat-value">{value}</span>
      <span className="stat-meta">{meta}</span>
    </div>
  );
}
