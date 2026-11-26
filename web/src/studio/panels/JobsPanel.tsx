import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useResource } from "../../lib/hooks";
import { useToast } from "../../app/Providers";
import { asArray, firstString, formatDate, formatNumber, statusTone, timeAgo, titleCase, truncate } from "../../lib/utils";
import type { JobRecord, JobSnapshot } from "../../lib/types";
import { Icon } from "../../components/Icon";
import {
  Banner,
  Button,
  Drawer,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Stat,
  Tag,
  Textarea,
} from "../../components/ui";
import { DetailRow, ErrorNote, JsonView, type PanelProps } from "../shared";

const JOB_TYPES = [
  { value: "compaction", label: "Dream compaction" },
  { value: "alpha_evolve", label: "Auto-tune" },
  { value: "benchmark", label: "Benchmark" },
  { value: "ingest", label: "Ingest" },
  { value: "memory_transform", label: "Memory transform" },
];

function duration(job: JobRecord): string {
  const ms = Number(job.duration_ms ?? 0);
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function JobsPanel({}: PanelProps) {
  const { toast } = useToast();
  const resource = useResource<JobSnapshot>(() => api.studio.jobs({ limit: 60 }), []);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [live, setLive] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [startOpen, setStartOpen] = useState(false);
  const [jobType, setJobType] = useState("compaction");
  const [paramsText, setParamsText] = useState("{}");
  const [startBusy, setStartBusy] = useState(false);
  const [selected, setSelected] = useState<JobRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (resource.data) setJobs(asArray(resource.data.jobs));
  }, [resource.data]);

  useEffect(() => {
    if (!live) {
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }
    const source = new EventSource("/api/studio/jobs/stream");
    sourceRef.current = source;
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as JobSnapshot & { type?: string };
        if (Array.isArray(payload.jobs)) {
          setJobs(payload.jobs);
        } else if (payload.job_id) {
          setJobs((prev) => {
            const next = prev.filter((job) => job.job_id !== (payload as unknown as JobRecord).job_id);
            return [{ ...(payload as unknown as JobRecord) }, ...next];
          });
        }
      } catch {
        /* ignore malformed keepalives */
      }
    };
    source.onerror = () => {
      source.close();
      sourceRef.current = null;
    };
    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [live]);

  const filtered = useMemo(() => {
    return jobs.filter((job) => statusFilter === "ALL" || String(job.status).toUpperCase() === statusFilter);
  }, [jobs, statusFilter]);

  const counts = useMemo(() => {
    const running = jobs.filter((job) => ["RUNNING", "QUEUED"].includes(String(job.status).toUpperCase())).length;
    const failed = jobs.filter((job) => String(job.status).toUpperCase() === "FAILED").length;
    const succeeded = jobs.filter((job) => String(job.status).toUpperCase() === "SUCCEEDED").length;
    return { running, failed, succeeded };
  }, [jobs]);

  const start = async () => {
    setStartBusy(true);
    try {
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(paramsText || "{}");
      } catch {
        throw new Error("Params must be valid JSON.");
      }
      await api.studio.startJob({ job_type: jobType, params, triggered_from: "Studio UI", title: titleCase(jobType) });
      toast("success", "Job queued", `${titleCase(jobType)} is starting.`);
      setStartOpen(false);
      setParamsText("{}");
      await resource.refresh();
    } catch (cause) {
      toast("error", "Could not start job", cause instanceof Error ? cause.message : undefined);
    } finally {
      setStartBusy(false);
    }
  };

  const act = async (action: "cancel" | "retry" | "detail", job: JobRecord) => {
    try {
      if (action === "detail") {
        const data = await api.studio.job(job.job_id);
        setSelected(data.job ?? job);
        setDetailOpen(true);
        return;
      }
      setBusy(`${action}-${job.job_id}`);
      if (action === "cancel") {
        await api.studio.cancelJob(job.job_id);
        toast("info", "Cancellation requested");
      } else {
        await api.studio.retryJob(job.job_id);
        toast("success", "Job retried");
      }
      await resource.refresh();
    } catch (cause) {
      toast("error", `Could not ${action} job`, cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Active" value={formatNumber(counts.running)} icon="activity" accent meta="running or queued" />
        <Stat label="Succeeded" value={formatNumber(counts.succeeded)} icon="checkCircle" meta="last 60 jobs" />
        <Stat label="Failed" value={formatNumber(counts.failed)} icon="alert" meta="needs a retry" />
        <Stat label="Total" value={formatNumber(jobs.length)} icon="layers" meta="in this window" />
      </div>

      <div className="row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8 }}>
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={{ width: 150 }}>
            <option value="ALL">All statuses</option>
            <option value="RUNNING">Running</option>
            <option value="QUEUED">Queued</option>
            <option value="SUCCEEDED">Succeeded</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELED">Canceled</option>
          </Select>
          <Button
            size="sm"
            variant={live ? "soft" : "secondary"}
            icon={live ? "zap" : "play"}
            onClick={() => setLive((prev) => !prev)}
          >
            {live ? "Live" : "Paused"}
          </Button>
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void resource.refresh()} loading={resource.loading}>Refresh</Button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Button
            size="sm"
            variant="ghost"
            icon="delete"
            onClick={async () => {
              setBusy("clear");
              try {
                await api.studio.clearJobs();
                toast("info", "Finished jobs cleared");
                await resource.refresh();
              } catch (cause) {
                toast("error", "Clear failed", cause instanceof Error ? cause.message : undefined);
              } finally {
                setBusy(null);
              }
            }}
            loading={busy === "clear"}
          >
            Clear finished
          </Button>
          <Button size="sm" variant="primary" icon="add" onClick={() => setStartOpen(true)}>Start job</Button>
        </div>
      </div>

      <ErrorNote error={resource.error} />

      <div className="surface">
        <div className="surface-head">
          <div>
            <h3>Pipeline jobs</h3>
            <p>Inline and background work with live progress from the job runner.</p>
          </div>
          <Tag tone={live ? "success" : "neutral"} dot={live}>{live ? "streaming" : "paused"}</Tag>
        </div>
        {resource.loading && jobs.length === 0 ? (
          <Spinner label="Loading jobs" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="activity"
            title="No jobs yet"
            copy="Run a dream cycle, benchmark or auto-tune; every long-running task appears here."
            action={<Button variant="primary" icon="add" onClick={() => setStartOpen(true)}>Start the first job</Button>}
          />
        ) : (
          <div>
            {filtered.map((job) => {
              const status = String(job.status ?? "QUEUED").toUpperCase();
              const progress = Number(job.progress ?? 0);
              return (
                <div className="job-row" key={job.job_id}>
                  <button
                    className="stack"
                    style={{ gap: 3, border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }}
                    onClick={() => act("detail", job)}
                  >
                    <span className="row" style={{ gap: 6 }}>
                      <strong style={{ fontSize: "var(--text-subhead)" }}>{firstString(job.title, titleCase(job.job_type), "Job")}</strong>
                      <span className="mono muted" style={{ fontSize: 10 }}>{truncate(job.job_id, 14)}</span>
                    </span>
                    <span className="muted" style={{ fontSize: "var(--text-caption-1)" }}>
                      {firstString(job.current_step, job.result_summary, titleCase(job.job_type), "Waiting")}
                    </span>
                    {status === "RUNNING" ? (
                      <span className="progress" style={{ marginTop: 3 }}>
                        <span style={{ inlineSize: `${Math.max(4, Math.min(100, progress))}%` }} />
                      </span>
                    ) : null}
                  </button>
                  <span><Tag tone={statusTone(status)}>{status}</Tag></span>
                  <span className="muted tnum" style={{ fontSize: "var(--text-caption-1)" }}>{duration(job)}</span>
                  <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                    <Button size="sm" variant="ghost" icon="chevronRight" onClick={() => act("detail", job)}>Details</Button>
                    {["RUNNING", "QUEUED"].includes(status) ? (
                      <Button size="sm" variant="ghost" icon="stop" onClick={() => act("cancel", job)} loading={busy === `cancel-${job.job_id}`}>Cancel</Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon="refresh" onClick={() => act("retry", job)} loading={busy === `retry-${job.job_id}`}>Retry</Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="surface-foot">
          <span className="muted" style={{ fontSize: "var(--text-caption-1)" }}>{filtered.length} jobs · updates stream over SSE</span>
          <span className="muted" style={{ fontSize: "var(--text-caption-1)" }}>Updated {timeAgo(new Date())}</span>
        </div>
      </div>

      <Modal
        open={startOpen}
        onClose={() => setStartOpen(false)}
        title="Start a job"
        description="Run a pipeline step immediately with optional parameters."
        footer={
          <>
            <Button variant="ghost" onClick={() => setStartOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="play" onClick={start} loading={startBusy}>Start job</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Job type" className="span-2">
            <Select value={jobType} onChange={(event) => setJobType(event.target.value)}>
              {JOB_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </Select>
          </Field>
          <Field label="Params (JSON)" className="span-2" hint={jobType === "compaction" ? '{"multi_session":true}' : undefined}>
            <Textarea
              value={paramsText}
              onChange={(event) => setParamsText(event.target.value)}
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-caption-1)", minBlockSize: 120 }}
            />
          </Field>
        </div>
        <Banner>
          <Icon name="info" size={16} />
          Inline jobs report their steps back to this page. Long jobs keep running if you leave the tab.
        </Banner>
      </Modal>

      <Drawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={selected ? firstString(selected.title, titleCase(selected.job_type), "Job") : "Job"}
        description={selected ? `${selected.job_id} · ${firstString(selected.triggered_from, "studio")}` : undefined}
        footer={
          selected ? (
            <>
              <Button variant="ghost" icon="copy" onClick={async () => {
                await navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
                toast("success", "Job copied");
              }}>Copy</Button>
              {["RUNNING", "QUEUED"].includes(String(selected.status).toUpperCase()) ? (
                <Button variant="danger" icon="stop" onClick={() => act("cancel", selected)}>Cancel job</Button>
              ) : (
                <Button variant="secondary" icon="refresh" onClick={() => act("retry", selected)}>Retry</Button>
              )}
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="stack">
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Tag tone={statusTone(selected.status)}>{selected.status}</Tag>
              <Tag>{titleCase(selected.job_type)}</Tag>
              <Tag>{duration(selected)}</Tag>
            </div>
            <div>
              <DetailRow label="Progress">{Number(selected.progress ?? 0)}%</DetailRow>
              <DetailRow label="Current step">{firstString(selected.current_step, "—")}</DetailRow>
              <DetailRow label="Result">{firstString(selected.result_summary, "—")}</DetailRow>
              <DetailRow label="Created">{formatDate(selected.created_at)}</DetailRow>
              <DetailRow label="Updated">{formatDate(selected.updated_at)}</DetailRow>
            </div>
            {selected.error ? <Banner tone="error">{selected.error}</Banner> : null}
            {asArray(selected.steps).length ? (
              <div>
                <div className="field-label" style={{ marginBottom: 6 }}>Timeline</div>
                <div className="steps">
                  {asArray(selected.steps).map((step, index) => (
                    <div className="step" key={index}>
                      <span className="dot live" />
                      <span style={{ fontSize: "var(--text-subhead)" }}>{firstString(step.message, step.name, `Step ${index + 1}`)}</span>
                      <span className="muted" style={{ marginLeft: "auto", fontSize: "var(--text-caption-2)" }}>{firstString(step.at, step.timestamp, "")}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <details>
              <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--text-subhead)" }}>Raw job</summary>
              <JsonView value={selected} />
            </details>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
