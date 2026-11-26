import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useResource } from "../../lib/hooks";
import { useToast, useWorkspace } from "../../app/Providers";
import { asArray, cn, firstString, formatDate, formatNumber, statusTone, timeAgo, truncate } from "../../lib/utils";
import type { StudioSession } from "../../lib/types";
import { Icon } from "../../components/Icon";
import { Button, Drawer, EmptyState, Input, Select, Spinner, Tag, Textarea } from "../../components/ui";
import { DetailRow, ErrorNote, JsonView, type PanelProps } from "../shared";

type DetailTab = "transcript" | "summary" | "ratings";

export function SessionsPanel({ state, refresh }: PanelProps) {
  const { toast } = useToast();
  const { userId } = useWorkspace();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("ALL");
  const [helpfulness, setHelpfulness] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>("transcript");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const resource = useResource(
    () => api.studio.sessions({ search_query: query, stream_source: source, helpfulness_status: helpfulness, limit: 60 }),
    [query, source, helpfulness],
  );

  const sessions = resource.data ? asArray(resource.data.sessions) : asArray(state.sessions);
  const selected = useMemo(
    () => sessions.find((session) => session.session_id === selectedId) ?? null,
    [sessions, selectedId],
  );

  useEffect(() => {
    if (!selectedId && sessions.length) setSelectedId(sessions[0].session_id);
  }, [sessions, selectedId]);

  const inspect = (session: StudioSession) => {
    setSelectedId(session.session_id);
    setTab("transcript");
    setNotes("");
    setOpen(true);
  };

  const summarize = async () => {
    if (!selected) return;
    setBusy("summarize");
    try {
      await api.studio.summarizeSession(selected.session_id, true);
      toast("success", "Session summarized", "Candidate memories were staged for review.");
      await resource.refresh();
      await refresh();
    } catch (cause) {
      toast("error", "Summarization failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const mineCandidates = async () => {
    if (!selected) return;
    setBusy("mine");
    try {
      const data = await api.studio.extractTrajectories({
        session_id: selected.session_id,
        user_id: userId,
        signal_filter: "ALL",
      });
      const count = asArray(data.candidates as Array<Record<string, unknown>>).length || Number(data.extracted_count ?? 0);
      toast("success", "Candidates mined", `${count} signals staged from this session.`);
      await refresh();
    } catch (cause) {
      toast("error", "Trajectory mining failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const rate = async (rating: "helpful" | "unhelpful") => {
    if (!selected) return;
    setBusy(rating);
    try {
      await api.studio.rateSession(selected.session_id, { rating, notes });
      toast("success", `Marked ${rating}`);
      setNotes("");
      await resource.refresh();
    } catch (cause) {
      toast("error", "Rating failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const turns = asArray(selected?.turns as Array<Record<string, unknown>>);

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions…"
            style={{ width: 240 }}
          />
          <Select value={source} onChange={(event) => setSource(event.target.value)} style={{ width: 150 }}>
            <option value="ALL">All sources</option>
            <option value="CHAT">Live chat</option>
            <option value="ANTIGRAVITY">Local agent</option>
            <option value="BYOT">Uploaded</option>
          </Select>
          <Select value={helpfulness} onChange={(event) => setHelpfulness(event.target.value)} style={{ width: 146 }}>
            <option value="ALL">Any rating</option>
            <option value="HELPFUL">Helpful</option>
            <option value="UNHELPFUL">Unhelpful</option>
            <option value="UNRATED">Unrated</option>
          </Select>
        </div>
        <Button icon="refresh" onClick={() => void resource.refresh()} loading={resource.loading}>Refresh</Button>
      </div>

      <ErrorNote error={resource.error} />

      {resource.loading && sessions.length === 0 ? (
        <div className="surface"><Spinner label="Loading sessions" /></div>
      ) : sessions.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon="messages"
            title="No sessions captured"
            copy="Start a live chat or import a transcript; sessions arrive here with turns, tool calls and summaries."
            action={<Button variant="primary" icon="message" onClick={() => window.location.assign("/")}>Start a chat</Button>}
          />
        </div>
      ) : (
        <div className="session-split">
          <div className="surface session-list" role="listbox" aria-label="Sessions">
            {sessions.map((session) => {
              const active = session.session_id === selectedId;
              return (
                <button
                  key={session.session_id}
                  className={cn("session-row", active && "is-active")}
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelectedId(session.session_id)}
                  onDoubleClick={() => inspect(session)}
                >
                  <span className="row-between" style={{ gap: 8 }}>
                    <span className="mono truncate" style={{ fontSize: "var(--text-caption-1)" }}>{session.session_id}</span>
                    <Tag tone={statusTone(firstString(session.helpfulness, session.helpfulness_status as string, "UNRATED"))}>{firstString(session.helpfulness, session.helpfulness_status as string, "unrated")}</Tag>
                  </span>
                  <span className="session-title">{truncate(firstString(session.summary, session.topic, session.title, "Untitled session"), 96)}</span>
                  <span className="session-meta">
                    <Icon name="messages" size={12} />
                    {asArray(session.turns).length || session.turn_count || 0} turns
                    <span>·</span>
                    {timeAgo(firstString(session.updated_at, session.created_at))}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="surface session-detail">
            {selected ? (
              <>
                <div className="surface-head">
                  <div style={{ minWidth: 0 }}>
                    <h3 className="truncate" style={{ maxWidth: 520 }}>{firstString(selected.summary, selected.topic, selected.title, selected.session_id)}</h3>
                    <p className="mono">{selected.session_id}</p>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <Tag tone={statusTone(firstString(selected.helpfulness, selected.helpfulness_status as string, "UNRATED"))}>{firstString(selected.helpfulness, selected.helpfulness_status as string, "unrated")}</Tag>
                    <Button size="sm" icon="sparkles" onClick={mineCandidates} loading={busy === "mine"}>
                      Mine
                    </Button>
                    <Button size="sm" icon="sparkles" variant="primary" onClick={summarize} loading={busy === "summarize"}>
                      Summarize
                    </Button>
                  </div>
                </div>
                <div className="row" style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)" }}>
                  {(["transcript", "summary", "ratings"] as DetailTab[]).map((item) => (
                    <button
                      key={item}
                      className={cn("segment", tab === item && "is-active")}
                      onClick={() => setTab(item)}
                      style={{ background: tab === item ? "var(--panel)" : "transparent" }}
                    >
                      {item === "transcript" ? `Transcript (${turns.length})` : item === "summary" ? "Summary" : "Ratings"}
                    </button>
                  ))}
                  <Button size="sm" variant="ghost" icon="arrowUpRight" onClick={() => { setOpen(true); }} style={{ marginLeft: "auto" }}>
                    Open
                  </Button>
                </div>
                <div className="session-body">
                  {tab === "transcript" ? (
                    turns.length === 0 ? (
                      <EmptyState icon="messages" title="No transcript turns" copy="This session has no turns stored yet." />
                    ) : (
                      turns.map((turn, index) => {
                        const role = firstString(turn.role, turn.event_type, "turn").toLowerCase();
                        return (
                          <div className={cn("turn-bubble", role.includes("user") ? "user" : "agent")} key={index}>
                            <span className="turn-bubble-role">{role.replace(/_/g, " ")}</span>
                            <span className="turn-bubble-text">
                              {truncate(firstString(turn.text, turn.content, turn.message, JSON.stringify(turn)), 1200)}
                            </span>
                          </div>
                        );
                      })
                    )
                  ) : tab === "summary" ? (
                    <div className="stack">
                      <p style={{ fontSize: "var(--text-callout)", lineHeight: 1.6 }}>
                        {firstString(selected.summary, "No summary yet. Run summarize to let Gemini compress this session and stage candidate memories.")}
                      </p>
                      <div>
                        <DetailRow label="Topic">{firstString(selected.topic, "—")}</DetailRow>
                        <DetailRow label="Source">{firstString(selected.stream_source, "—")}</DetailRow>
                        <DetailRow label="Turns">{String(selected.turn_count ?? turns.length)}</DetailRow>
                        <DetailRow label="Created">{formatDate(selected.created_at)}</DetailRow>
                        <DetailRow label="Memories injected">{formatNumber(selected.memories_injected?.length ?? 0)}</DetailRow>
                      </div>
                      <details>
                        <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--text-subhead)" }}>Raw session</summary>
                        <JsonView value={selected} />
                      </details>
                    </div>
                  ) : (
                    <div className="stack">
                      <div className="grid grid-2">
                        <Button icon="checkCircle" onClick={() => rate("helpful")} loading={busy === "helpful"}>Helpful</Button>
                        <Button icon="alert" onClick={() => rate("unhelpful")} loading={busy === "unhelpful"}>Unhelpful</Button>
                      </div>
                      <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Why? This note becomes a regression signal." />
                      <Bannerish />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <EmptyState icon="messages" title="Select a session" copy="Pick a session on the left to inspect its transcript." />
            )}
          </div>
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={selected ? selected.session_id : "Session"}
        description={selected ? `${firstString(selected.stream_source, "session")} · ${formatDate(selected.created_at)}` : undefined}
        footer={
          selected ? (
            <>
              <Button variant="ghost" icon="alert" onClick={() => rate("unhelpful")} loading={busy === "unhelpful"}>Unhelpful</Button>
              <Button variant="secondary" icon="checkCircle" onClick={() => rate("helpful")} loading={busy === "helpful"}>Helpful</Button>
              <Button variant="primary" icon="sparkles" onClick={summarize} loading={busy === "summarize"}>Summarize</Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="stack">
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Tag tone={statusTone(firstString(selected.helpfulness, selected.helpfulness_status as string, "UNRATED"))}>{firstString(selected.helpfulness, selected.helpfulness_status as string, "unrated")}</Tag>
              <Tag>{firstString(selected.stream_source, "chat")}</Tag>
              <Tag>{selected.turn_count ?? turns.length} turns</Tag>
            </div>
            {turns.length === 0 ? (
              <EmptyState icon="messages" title="No turns" />
            ) : (
              turns.map((turn, index) => (
                <div key={index} className="stack" style={{ gap: 3 }}>
                  <span className="field-label">{firstString(turn.role, turn.event_type, "turn")}</span>
                  <p style={{ fontSize: "var(--text-subhead)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {truncate(firstString(turn.text, turn.content, turn.message, JSON.stringify(turn)), 2200)}
                  </p>
                </div>
              ))
            )}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function Bannerish() {
  return (
    <p className="muted" style={{ fontSize: "var(--text-caption-1)", lineHeight: 1.5 }}>
      Ratings feed the evaluation set. An unhelpful session with a note becomes a labeled regression case for auto-tune.
    </p>
  );
}
