import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useResource } from "../lib/hooks";
import { useToast, useWorkspace } from "../app/Providers";
import {
  asArray,
  cn,
  copyText,
  firstString,
  formatDate,
  formatNumber,
  statusTone,
  timeAgo,
  truncate,
} from "../lib/utils";
import type { ChatMessage, LogRecord, PreferenceRecord } from "../lib/types";
import { Icon } from "../components/Icon";
import {
  Banner,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  Spinner,
  Stat,
  Switch,
  Tag,
  Textarea,
} from "../components/ui";

type Stage = "capture" | "activity" | "extract" | "rules" | "recall";
type CaptureMode = "chat" | "local" | "upload";
type RuleTab = "preferences" | "guardrails" | "summaries";

const STAGES: Array<{ value: Stage; label: string; icon: "message" | "activity" | "sparkles" | "shield" | "search"; copy: string }> = [
  { value: "capture", label: "Capture", icon: "message", copy: "Talk to the agent or import a transcript" },
  { value: "activity", label: "Activity", icon: "activity", copy: "Every recorded turn and tool call" },
  { value: "extract", label: "Extract", icon: "sparkles", copy: "Consolidate sessions into durable rules" },
  { value: "rules", label: "Saved rules", icon: "shield", copy: "Beliefs, guardrails and summaries" },
  { value: "recall", label: "Recall", icon: "search", copy: "Ask what the agent remembers" },
];

function renderRichText(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : <span key={index}>{part}</span>,
  );
}

function formatEvent(eventType: unknown): string {
  const raw = String(eventType ?? "EVENT").toUpperCase();
  const map: Record<string, string> = {
    USER_PROMPT: "Prompt",
    AGENT_RESPONSE: "Reply",
    SYSTEM_MESSAGE: "System",
    TOOL_CALL: "Tool call",
    TOOL_RESULT: "Tool result",
    ERROR_MESSAGE: "Error",
    EPHEMERAL_MESSAGE: "Context",
  };
  return map[raw] ?? raw.replace(/_/g, " ").toLowerCase();
}

function MessageList({ messages, loading }: { messages: ChatMessage[]; loading: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, loading]);

  return (
    <div className="chat-scroll">
      {messages.map((message) => (
        <div key={message.id} className={cn("msg", message.role === "user" && "user")}>
          <div className="msg-meta">
            <span>{message.role === "user" ? "You" : message.role === "assistant" ? "Agent" : "System"}</span>
            {message.meta ? <Tag>{message.meta}</Tag> : null}
          </div>
          <div className="msg-bubble">{renderRichText(message.text)}</div>
        </div>
      ))}
      {loading ? (
        <div className="msg">
          <div className="msg-meta">Agent</div>
          <div className="msg-bubble row" style={{ gap: 7, color: "var(--fg-muted)" }}>
            <span className="spinner" style={{ width: 13, height: 13 }} />
            Thinking…
          </div>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

/* ------------------------------------------------------------------ capture */

function CaptureStage() {
  const { userId, sessionId, newSession, scopes } = useWorkspace();
  const { toast } = useToast();
  const [mode, setMode] = useState<CaptureMode>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "hello",
      role: "assistant",
      text: "I'm the reference agent. Tell me something about how you work — a preference, a correction, a rule — and Everstate will capture the session for the next dream cycle.",
      meta: "Live session",
      at: Date.now(),
    },
  ]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [turns, setTurns] = useState<Array<Record<string, unknown>>>([]);
  const [selectedLocal, setSelectedLocal] = useState("");
  const [uploadText, setUploadText] = useState("");
  const [uploadFormat, setUploadFormat] = useState("auto");
  const [uploadSession, setUploadSession] = useState(`byot-${Date.now().toString(36)}`);
  const [busy, setBusy] = useState<string | null>(null);

  const localSessions = useResource(() => api.capture.antigravitySessions(), []);
  const sessions = asArray(localSessions.data?.sessions);

  useEffect(() => {
    if (!selectedLocal && sessions.length) setSelectedLocal(sessions[0].session_id);
  }, [sessions, selectedLocal]);

  const loadTurns = useCallback(async (id: string) => {
    if (!id) return;
    setBusy("turns");
    try {
      const data = await api.capture.antigravityTurns(id);
      setTurns(asArray(data.turns as Array<Record<string, unknown>>));
    } catch (cause) {
      toast("error", "Could not load turns", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  }, [toast]);

  useEffect(() => {
    if (mode === "local" && selectedLocal) void loadTurns(selectedLocal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedLocal]);

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || thinking) return;
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: "user", text: prompt, at: Date.now() };
    setMessages((prev) => [...prev, userMessage]);
    setDraft("");
    setThinking(true);
    try {
      const data = await api.chat.interview({ user_id: userId, session_id: sessionId, prompt });
      const response = firstString(data.response, "The agent returned an empty response.") as string;
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: response, meta: "Interview agent", at: Date.now() },
      ]);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "The agent could not be reached.";
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "system", text: message, meta: "Error", at: Date.now() },
      ]);
    } finally {
      setThinking(false);
    }
  };

  const ingestLocal = async () => {
    if (!selectedLocal) return;
    setBusy("ingest-local");
    try {
      const data = await api.capture.ingestAntigravity({ user_id: userId, session_id: selectedLocal });
      toast("success", "Session ingested", `${data.turns_ingested ?? 0} turns landed in BigQuery.`);
    } catch (cause) {
      toast("error", "Ingest failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const ingestUpload = async () => {
    if (!uploadText.trim()) {
      toast("error", "Nothing to import", "Paste a transcript or drop a file first.");
      return;
    }
    setBusy("ingest-upload");
    try {
      const data = await api.capture.ingestTranscript({
        user_id: userId,
        session_id: uploadSession.trim() || sessionId,
        content: uploadText,
        format: uploadFormat,
      });
      toast("success", "Transcript imported", `${data.turns_ingested ?? 0} turns · session ${uploadSession}`);
      setUploadText("");
    } catch (cause) {
      toast("error", "Import failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="chat-layout">
      <div className="surface" style={{ overflow: "hidden" }}>
        <div className="surface-head">
          <div>
            <h3>{mode === "chat" ? "Live chat" : mode === "local" ? "Local agent sessions" : "Upload a transcript"}</h3>
            <p>
              {mode === "chat"
                ? "Every turn is recorded against the active user and session."
                : mode === "local"
                  ? "Import sessions recorded by a local coding agent."
                  : "Bring your own JSON, JSONL or plain-text transcript."}
            </p>
          </div>
          <Segmented
            ariaLabel="Capture source"
            value={mode}
            onChange={(next) => setMode(next)}
            options={[
              { value: "chat", label: "Chat", icon: "message" },
              { value: "local", label: "Local", icon: "code" },
              { value: "upload", label: "Upload", icon: "upload" },
            ]}
          />
        </div>

        {mode === "chat" ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", minBlockSize: 480 }}>
              <MessageList messages={messages} loading={thinking} />
            </div>
            <div className="prompt-chips">
              {[
                "My name is Maya. I'm a staff platform engineer.",
                "I always run Python tests with `uv run pytest`.",
                "Never use Docker on this machine — use Apple containers.",
              ].map((prompt) => (
                <button key={prompt} className="prompt-chip" onClick={() => setDraft(prompt)}>
                  {truncate(prompt, 44)}
                </button>
              ))}
            </div>
            <div className="chat-composer">
              <textarea
                value={draft}
                placeholder="Tell the agent something worth remembering…"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <Button variant="primary" icon="arrowUp" onClick={send} loading={thinking} aria-label="Send message" />
            </div>
          </>
        ) : mode === "local" ? (
          <div className="surface-body stack">
            <div className="row" style={{ flexWrap: "wrap" }}>
              <Select
                value={selectedLocal}
                onChange={(event) => setSelectedLocal(event.target.value)}
                style={{ flex: 1, minWidth: 220 }}
              >
                {sessions.length === 0 ? <option value="">No local sessions found</option> : null}
                {sessions.map((session) => (
                  <option key={session.session_id} value={session.session_id}>
                    {session.session_id} · {session.turns_count ?? session.turn_count ?? asArray(session.turns).length} turns
                  </option>
                ))}
              </Select>
              <Button icon="refresh" onClick={() => localSessions.refresh()} loading={localSessions.loading}>
                Refresh
              </Button>
              <Button variant="primary" icon="database" onClick={ingestLocal} loading={busy === "ingest-local"} disabled={!selectedLocal}>
                Ingest
              </Button>
            </div>
            {localSessions.error ? <Banner tone="error">{localSessions.error}</Banner> : null}
            <div className="surface" style={{ maxHeight: 480, overflowY: "auto" }}>
              {busy === "turns" ? (
                <Spinner label="Loading turns" />
              ) : turns.length === 0 ? (
                <EmptyState
                  icon="messages"
                  title="No turns loaded"
                  copy="Pick a local session and Everstate will preview its transcript before ingesting it."
                />
              ) : (
                <div style={{ padding: "4px 16px" }}>
                  {turns.map((turn, index) => (
                    <div className="turn" key={index}>
                      <span className="turn-role">{String(turn.role ?? turn.event_type ?? "turn")}</span>
                      <span className="turn-text">{truncate(firstString(turn.text, turn.content, turn.message), 700)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="surface-body stack">
            <div className="form-grid">
              <Field label="Session ID">
                <Input value={uploadSession} onChange={(event) => setUploadSession(event.target.value)} />
              </Field>
              <Field label="Format">
                <Select value={uploadFormat} onChange={(event) => setUploadFormat(event.target.value)}>
                  <option value="auto">Auto detect</option>
                  <option value="json">JSON</option>
                  <option value="jsonl">JSONL</option>
                  <option value="text">Plain text</option>
                </Select>
              </Field>
            </div>
            <label
              className="dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={async (event) => {
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (!file) return;
                setUploadText(await file.text());
                toast("info", "File loaded", file.name);
              }}
            >
              <Icon name="cloudUpload" size={22} />
              <strong style={{ color: "var(--fg)" }}>Drop a transcript file</strong>
              <span style={{ fontSize: "var(--text-caption-1)" }}>or paste it below — JSON, JSONL or plain text</span>
              <input
                type="file"
                accept=".json,.jsonl,.txt,.md"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setUploadText(await file.text());
                  toast("info", "File loaded", file.name);
                }}
              />
            </label>
            <Textarea
              value={uploadText}
              onChange={(event) => setUploadText(event.target.value)}
              placeholder='[{"role":"user","text":"Always run tests with uv run pytest"}]'
              style={{ minBlockSize: 160 }}
            />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setUploadText("")}>
                Clear
              </Button>
              <Button variant="primary" icon="upload" onClick={ingestUpload} loading={busy === "ingest-upload"}>
                Import transcript
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="stack">
        <div className="surface rail-card">
          <div className="row-between">
            <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Active scope</span>
            <Tag tone="accent">live</Tag>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {[
              ["User", userId],
              ["Session", sessionId],
              ["Team", scopes.team_id],
              ["Agent", scopes.agent_id],
            ].map(([label, value]) => (
              <div key={label} className="row-between" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: "var(--text-caption-1)" }}>{label}</span>
                <span className="mono truncate" style={{ fontSize: "var(--text-caption-1)", maxWidth: 180 }} title={value}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" icon="refresh" onClick={newSession} style={{ flex: 1 }}>
              New session
            </Button>
            <Button
              size="sm"
              icon="copy"
              onClick={async () => {
                await copyText(JSON.stringify({ user: userId, session: sessionId, ...scopes }, null, 2));
                toast("success", "Scope copied");
              }}
            >
              Copy
            </Button>
          </div>
        </div>

        <div className="surface rail-card">
          <span className="section-title" style={{ fontSize: "var(--text-body)" }}>What happens next</span>
          <ol className="stack" style={{ gap: 9, paddingLeft: 18, margin: 0, color: "var(--fg-muted)", fontSize: "var(--text-subhead)" }}>
            <li>Session turns land in BigQuery.</li>
            <li>The dream cycle distills candidate rules.</li>
            <li>You review and commit them in Memories.</li>
            <li>Recall serves them with no model call.</li>
          </ol>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Tag tone="success">BigQuery</Tag>
            <Tag tone="accent">Spanner</Tag>
            <Tag>Gemini</Tag>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- activity */

function ActivityStage() {
  const [sessionFilter, setSessionFilter] = useState("ALL");
  const [limit, setLimit] = useState(50);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [query, setQuery] = useState("");

  const lakehouse = useResource(() => api.capture.lakehouseSessions(), []);
  const logs = useResource(() => api.capture.logs(sessionFilter), [sessionFilter]);
  const records = asArray(logs.data?.logs);
  const sessions = asArray(lakehouse.data?.sessions);

  const filtered = useMemo(() => {
    return records.filter((record) => {
      if (typeFilter !== "ALL" && String(record.event_type ?? "").toUpperCase() !== typeFilter) return false;
      if (!query.trim()) return true;
      const haystack = `${record.message ?? ""} ${record.content ?? ""} ${record.intent ?? ""}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
  }, [records, typeFilter, query]);

  const visible = filtered.slice(0, limit);

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Turns loaded" value={formatNumber(records.length)} icon="activity" />
        <Stat label="Sessions" value={formatNumber(sessions.length)} icon="messages" />
        <Stat label="Tool calls" value={formatNumber(records.filter((r) => String(r.event_type).toUpperCase() === "TOOL_CALL").length)} icon="wrench" />
        <Stat label="Errors" value={formatNumber(records.filter((r) => String(r.event_type).toUpperCase() === "ERROR_MESSAGE").length)} icon="alert" />
      </div>

      <div className="surface">
        <div className="surface-head">
          <div>
            <h3>Recorded activity</h3>
            <p>Live telemetry from the lakehouse, scoped by session.</p>
          </div>
          <div className="panel-toolbar">
            <Select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} style={{ width: 240 }}>
              <option value="ALL">All sessions</option>
              {sessions.map((session) => (
                <option key={session.session_id} value={session.session_id}>
                  {session.session_id} {session.event_count ? `· ${session.event_count} events` : ""}
                </option>
              ))}
            </Select>
            <Button icon="refresh" onClick={() => logs.refresh()} loading={logs.loading}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="surface-body" style={{ paddingBottom: 8 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={{ width: 168 }}>
              <option value="ALL">All event types</option>
              <option value="USER_PROMPT">Prompt</option>
              <option value="AGENT_RESPONSE">Reply</option>
              <option value="TOOL_CALL">Tool call</option>
              <option value="TOOL_RESULT">Tool result</option>
              <option value="ERROR_MESSAGE">Error</option>
            </Select>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages…"
              style={{ flex: 1, minWidth: 200 }}
            />
          </div>
        </div>
        {logs.error ? <div style={{ padding: 16 }}><Banner tone="error">{logs.error}</Banner></div> : null}
        {logs.loading && records.length === 0 ? (
          <Spinner label="Loading activity" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="activity"
            title="No activity recorded"
            copy="Start a live chat or ingest a transcript, then refresh this view."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Type</th>
                    <th>Message</th>
                    <th style={{ width: 120 }}>Session</th>
                    <th style={{ width: 130 }}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((record, index) => (
                    <tr key={index}>
                      <td><Tag tone={statusTone(record.event_type === "ERROR_MESSAGE" ? "FAILED" : "INFO")}>{formatEvent(record.event_type)}</Tag></td>
                      <td>
                        <div className="cell-main" style={{ fontWeight: 400, whiteSpace: "pre-wrap" }}>
                          {truncate(firstString(record.message, record.content, record.intent, "(empty)"), 420)}
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: "var(--text-caption-1)" }}>
                        {truncate(firstString(record.session_id, sessionFilter === "ALL" ? "—" : sessionFilter), 18)}
                      </td>
                      <td className="muted" style={{ fontSize: "var(--text-caption-1)" }}>
                        {formatDate(firstString(record.timestamp, record.created_at))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="surface-foot">
              <span className="muted" style={{ fontSize: "var(--text-caption-1)" }}>
                Showing {visible.length} of {filtered.length}
              </span>
              <div className="row">
                {filtered.length > visible.length ? (
                  <Button size="sm" onClick={() => setLimit((prev) => prev + 50)}>
                    Show 50 more
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setLimit(50)} disabled={limit === 50}>
                  Collapse
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ extract */

function ExtractStage() {
  const { userId, sessionId } = useWorkspace();
  const { toast } = useToast();
  const lakehouse = useResource(() => api.capture.lakehouseSessions(), []);
  const [target, setTarget] = useState(sessionId);
  const [multi, setMulti] = useState(false);
  const [sessionType, setSessionType] = useState("chat");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const sessions = asArray(lakehouse.data?.sessions);

  useEffect(() => {
    if (target === sessionId && sessions.length && !sessions.some((s) => s.session_id === target)) {
      setTarget(sessions[0].session_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length]);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const data = await api.capture.harvest({
        user_id: userId,
        session_id: multi ? undefined : target,
        multi_session: multi,
        session_type: sessionType,
      });
      setResult(data);
      toast("success", "Extraction complete", `${data.preferences_synced ?? 0} rules staged.`);
    } catch (cause) {
      toast("error", "Extraction failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-rail">
      <div className="stack">
        <div className="surface">
          <div className="surface-head">
            <div>
              <h3>Dream cycle</h3>
              <p>Gemini reads the selected activity and proposes durable rules. Nothing is committed until you review it.</p>
            </div>
            <Tag tone="accent"><Icon name="sparkles" size={13} /> extraction</Tag>
          </div>
          <div className="surface-body stack">
            <Field label="Source session">
              <Select value={multi ? "ALL" : target} onChange={(event) => setTarget(event.target.value)} disabled={multi}>
                <option value="ALL">All recent sessions</option>
                {sessions.map((session) => (
                  <option key={session.session_id} value={session.session_id}>
                    {session.session_id} {session.summary ? `— ${truncate(session.summary, 48)}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="form-grid">
              <Field label="Session type">
                <Select value={sessionType} onChange={(event) => setSessionType(event.target.value)}>
                  <option value="chat">Live chat</option>
                  <option value="antigravity">Local agent</option>
                </Select>
              </Field>
              <div className="field">
                <span className="field-label">Compaction</span>
                <Switch checked={multi} onChange={setMulti} label="Cross-session dream" />
              </div>
            </div>
            <Banner>
              <Icon name="info" size={16} />
              <span>
                The dream cycle extracts candidates and stages them. Approve them in <strong>Memories</strong> to make them
                recallable.
              </span>
            </Banner>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button variant="primary" icon="sparkles" onClick={run} loading={busy}>
                {multi ? "Run multi-session dream" : "Run dream cycle"}
              </Button>
            </div>
          </div>
        </div>

        {result ? (
          <div className="surface">
            <div className="surface-head">
              <div>
                <h3>Extraction result</h3>
                <p>
                  {formatNumber(result.preferences_synced ?? 0)} rules ·{" "}
                  {formatNumber(result.sessions_processed ?? (multi ? sessions.length : 1))} sessions
                </p>
              </div>
              <Tag tone="success">complete</Tag>
            </div>
            <div className="surface-body stack">
              <div className="grid grid-3">
                <Stat label="Rules saved" value={formatNumber(result.preferences_synced ?? 0)} icon="shield" />
                <Stat label="Sessions read" value={formatNumber(result.sessions_processed ?? 1)} icon="messages" />
                <Stat label="Model" value={String(result.model ?? "Gemini")} icon="ai" />
              </div>
              <details>
                <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--text-subhead)" }}>Raw response</summary>
                <pre className="code-block">{JSON.stringify(result, null, 2)}</pre>
              </details>
            </div>
          </div>
        ) : null}
      </div>

      <div className="stack">
        <div className="surface rail-card">
          <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Two-phase sleep</span>
          <div className="stack" style={{ gap: 10 }}>
            <div>
              <div className="row" style={{ gap: 6 }}>
                <Tag tone="info">NREM</Tag>
                <strong style={{ fontSize: "var(--text-subhead)" }}>Compress</strong>
              </div>
              <p className="muted" style={{ fontSize: "var(--text-caption-1)", marginTop: 4 }}>
                Deduplicate turns, scrub PII and summarize what happened.
              </p>
            </div>
            <div>
              <div className="row" style={{ gap: 6 }}>
                <Tag tone="accent">REM</Tag>
                <strong style={{ fontSize: "var(--text-subhead)" }}>Synthesize</strong>
              </div>
              <p className="muted" style={{ fontSize: "var(--text-caption-1)", marginTop: 4 }}>
                Turn corrections and repeated workflows into scoped, testable beliefs.
              </p>
            </div>
          </div>
        </div>
        <div className="surface rail-card">
          <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Guardrails</span>
          <p className="muted" style={{ fontSize: "var(--text-subhead)", lineHeight: 1.5 }}>
            Contradictions are never auto-committed. Conflicting candidates are held for review in the memory tree.
          </p>
          <Button size="sm" icon="shield" onClick={() => window.location.assign("/studio?s=optimize")}>
            Open optimizer
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- rules */

function RulesStage() {
  const { userId } = useWorkspace();
  const [tab, setTab] = useState<RuleTab>("preferences");
  const prefs = useResource(() => api.memory.preferences(userId), [userId]);
  const guardrails = useResource(() => api.memory.guardrails(userId), [userId]);
  const summaries = useResource(() => api.memory.summaries(userId), [userId]);
  const [query, setQuery] = useState("");

  const data = useMemo(() => {
    if (tab === "preferences") return asArray(prefs.data?.preferences);
    if (tab === "guardrails") return asArray(guardrails.data?.guardrails);
    return asArray(summaries.data?.summaries);
  }, [tab, prefs.data, guardrails.data, summaries.data]);

  const filtered = data.filter((record) =>
    !query.trim() || JSON.stringify(record).toLowerCase().includes(query.toLowerCase()),
  );

  const loading = tab === "preferences" ? prefs.loading : tab === "guardrails" ? guardrails.loading : summaries.loading;
  const error = tab === "preferences" ? prefs.error : tab === "guardrails" ? guardrails.error : summaries.error;

  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: "wrap", gap: 10 }}>
        <Segmented
          ariaLabel="Rule type"
          value={tab}
          onChange={setTab}
          options={[
            { value: "preferences", label: "Beliefs", count: asArray(prefs.data?.preferences).length },
            { value: "guardrails", label: "Guardrails", count: asArray(guardrails.data?.guardrails).length },
            { value: "summaries", label: "Summaries", count: asArray(summaries.data?.summaries).length },
          ]}
        />
        <div className="row" style={{ gap: 8 }}>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter…" style={{ width: 220 }} />
          <Button
            icon="refresh"
            onClick={() => {
              void prefs.refresh();
              void guardrails.refresh();
              void summaries.refresh();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}

      {loading && filtered.length === 0 ? (
        <Spinner label="Loading memory" />
      ) : filtered.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon="shield"
            title={tab === "summaries" ? "No session summaries yet" : "No rules saved yet"}
            copy="Run the dream cycle on a captured session, then review the candidates in Memories."
            action={<Button variant="primary" icon="sparkles" onClick={() => window.location.assign("/?stage=extract")}>Run extraction</Button>}
          />
        </div>
      ) : tab === "summaries" ? (
        <div className="grid grid-2">
          {filtered.map((record, index) => (
            <div className="memory-card" key={index}>
              <div className="row-between">
                <span className="memory-key">{firstString(record.session_id, `summary-${index + 1}`)}</span>
                <Tag tone={statusTone(record.status ?? "OK")}>{String(record.status ?? "ready")}</Tag>
              </div>
              <p className="memory-value" style={{ whiteSpace: "pre-wrap" }}>
                {truncate(firstString(record.summary, record.content, record.text, JSON.stringify(record)), 700)}
              </p>
              <div className="memory-meta">
                <span>{formatDate(record.created_at ?? record.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-2">
          {filtered.map((record, index) => {
            const preference = record as PreferenceRecord;
            const key = firstString(preference.preference_key, preference.memory_key, `rule-${index + 1}`);
            const value = firstString(preference.preference_value, preference.memory_value, preference.crystallized_belief, "");
            return (
              <div className="memory-card" key={`${key}-${index}`}>
                <div className="row-between">
                  <span className="memory-key">{key}</span>
                  <Tag tone={tab === "guardrails" ? "danger" : "accent"}>{tab === "guardrails" ? "invariant" : firstString(preference.category, "belief")}</Tag>
                </div>
                <p className="memory-value" style={{ whiteSpace: "pre-wrap" }}>{truncate(value, 700)}</p>
                {preference.crystallized_belief && preference.crystallized_belief !== value ? (
                  <p className="muted" style={{ fontSize: "var(--text-caption-1)" }}>{truncate(preference.crystallized_belief, 300)}</p>
                ) : null}
                <div className="memory-meta">
                  <span>confidence {typeof preference.confidence === "number" ? preference.confidence.toFixed(2) : "—"}</span>
                  <span>·</span>
                  <span>{firstString(preference.memory_type, "PREFERENCE")}</span>
                  <span>·</span>
                  <span>{timeAgo(preference.updated_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- recall */

function RecallStage() {
  const { userId, sessionId, scopes } = useWorkspace();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "recall-hello",
      role: "assistant",
      text: "Ask me what the agent remembers about you. A direct memory hit returns from Spanner without any model call.",
      meta: "Recall",
      at: Date.now(),
    },
  ]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [lastMeta, setLastMeta] = useState<{ source?: string; latency?: number } | null>(null);
  const [mcpTool, setMcpTool] = useState("get_user_crystallized_beliefs");
  const [mcpArgs, setMcpArgs] = useState(
    JSON.stringify({ user_id: scopes.user_id }, null, 2),
  );
  const [mcpResult, setMcpResult] = useState<Record<string, unknown> | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);

  const mcpTools = [
    "get_user_crystallized_beliefs",
    "get_recent_session_memory",
    "search_agent_memories",
    "federated_scoped_memory_lookup",
    "crystallize_live_preference",
    "promote_scoped_memory",
  ];

  const runMcp = async () => {
    setMcpBusy(true);
    try {
      const args = JSON.parse(mcpArgs || "{}") as Record<string, unknown>;
      const result = await api.chat.mcp(mcpTool, args);
      setMcpResult(result);
      toast("success", "MCP tool returned", `${mcpTool} · ${firstString(result.latency_ms, "?")}ms`);
    } catch (cause) {
      toast("error", "MCP tool failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setMcpBusy(false);
    }
  };

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || thinking) return;
    setMessages((prev) => [...prev, { id: `rq-${Date.now()}`, role: "user", text: prompt, at: Date.now() }]);
    setDraft("");
    setThinking(true);
    const started = performance.now();
    try {
      const data = await api.chat.recall({ user_id: userId, session_id: sessionId, prompt });
      const latency = Number(data.latency_ms ?? Math.round(performance.now() - started));
      const source = firstString(data.source, "MEMORY");
      setLastMeta({ source, latency });
      setMessages((prev) => [
        ...prev,
        {
          id: `ra-${Date.now()}`,
          role: "assistant",
          text: firstString(data.response, "No response returned.") as string,
          meta: `${source.toLowerCase()} · ${latency}ms`,
          at: Date.now(),
        },
      ]);
    } catch (cause) {
      setMessages((prev) => [
        ...prev,
        { id: `re-${Date.now()}`, role: "system", text: cause instanceof Error ? cause.message : "Recall failed.", meta: "Error", at: Date.now() },
      ]);
    } finally {
      setThinking(false);
    }
  };

  const direct = lastMeta?.source === "SPANNER_CACHE";

  return (
    <div className="grid grid-rail">
      <div className="surface" style={{ overflow: "hidden" }}>
        <div className="surface-head">
          <div>
            <h3>Recall console</h3>
            <p>Answers come from scoped memory first, then the model.</p>
          </div>
          {lastMeta ? (
            <Tag tone={direct ? "success" : "warning"}>
              {direct ? "Direct memory hit" : "Model fallback"} · {lastMeta.latency}ms
            </Tag>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", minBlockSize: 440 }}>
          <MessageList messages={messages} loading={thinking} />
        </div>
        <div className="prompt-chips">
          {["What is my favorite language?", "What is my role?", "Which package manager should I use?", "What should you never do?"].map((prompt) => (
            <button key={prompt} className="prompt-chip" onClick={() => setDraft(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <div className="chat-composer">
          <textarea
            value={draft}
            placeholder="Ask about a stored belief, preference or guardrail…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Button variant="primary" icon="search" onClick={send} loading={thinking} aria-label="Ask memory" />
        </div>
      </div>

      <div className="stack">
        <div className="surface rail-card">
          <span className="section-title" style={{ fontSize: "var(--text-body)" }}>How recall works</span>
          <div className="stack" style={{ gap: 9 }}>
            {[
              ["01", "Embed", "The question is embedded with the active Matryoshka slice."],
              ["02", "Match", "Cosine + keyword match runs across org, team, agent and user scopes."],
              ["03", "Inject", "The top rules are formatted into a compact context frame."],
              ["04", "Answer", "A direct hit skips the model; otherwise the agent answers normally."],
            ].map(([n, title, copy]) => (
              <div className="row" key={n} style={{ alignItems: "flex-start", gap: 8 }}>
                <span className="pipeline-num">{n}</span>
                <div>
                  <strong style={{ fontSize: "var(--text-subhead)" }}>{title}</strong>
                  <p className="muted" style={{ fontSize: "var(--text-caption-1)", lineHeight: 1.45 }}>{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="surface rail-card">
          <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Extract a test</span>
          <p className="muted" style={{ fontSize: "var(--text-subhead)", lineHeight: 1.5 }}>
            Ask a question and turn the answer into a repeatable scenario in the optimizer.
          </p>
          <Button
            size="sm"
            icon="test"
            onClick={() => {
              toast("info", "Create a scenario", "Use Optimize → Test cases to add the expected fact.");
              window.location.assign("/studio?s=optimize");
            }}
          >
            Open test cases
          </Button>
        </div>

        <div className="surface rail-card">
          <div className="row-between">
            <span className="section-title" style={{ fontSize: "var(--text-body)" }}>MCP tool</span>
            <Tag tone="accent">developer</Tag>
          </div>
          <Field label="Tool">
            <Select
              value={mcpTool}
              onChange={(event) => {
                const tool = event.target.value;
                setMcpTool(tool);
                const defaults: Record<string, Record<string, unknown>> = {
                  get_user_crystallized_beliefs: { user_id: scopes.user_id },
                  get_recent_session_memory: { user_id: scopes.user_id, session_id: sessionId, limit: 5 },
                  search_agent_memories: { user_id: scopes.user_id, query: "python" },
                  federated_scoped_memory_lookup: { user_id: scopes.user_id, team_id: scopes.team_id, agent_id: scopes.agent_id, query: "python" },
                  crystallize_live_preference: { user_id: scopes.user_id, preference_key: "example_rule", preference_value: "Use uv for Python.", category: "workflow" },
                  promote_scoped_memory: { source_scope_type: "USER", source_scope_id: scopes.user_id, memory_key: "example_rule", target_scope_type: "TEAM", target_scope_id: scopes.team_id },
                };
                setMcpArgs(JSON.stringify(defaults[tool] ?? {}, null, 2));
              }}
            >
              {mcpTools.map((tool) => <option key={tool} value={tool}>{tool}</option>)}
            </Select>
          </Field>
          <Field label="Arguments (JSON)">
            <Textarea
              value={mcpArgs}
              onChange={(event) => setMcpArgs(event.target.value)}
              style={{ minBlockSize: 110, fontFamily: "var(--font-mono)", fontSize: "var(--text-caption-1)" }}
            />
          </Field>
          <Button size="sm" variant="secondary" icon="play" onClick={runMcp} loading={mcpBusy}>Run tool</Button>
          {mcpResult ? (
            <pre className="code-block" style={{ maxHeight: 220, margin: 0 }}>{JSON.stringify(mcpResult, null, 2)}</pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- page */

export function ChatPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { userId } = useWorkspace();
  const stage = (params.get("stage") as Stage) || "capture";

  const setStage = (next: Stage) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("stage", next);
    setParams(nextParams, { replace: true });
  };

  const lakehouse = useResource(() => api.capture.lakehouseSessions(), []);
  const prefs = useResource(() => api.memory.preferences(userId), [userId]);
  const rulesCount = asArray(prefs.data?.preferences).length;

  return (
    <main className="app-content" id="main-content">
      <PageHeader
        eyebrow={<><Icon name="sparkles" size={13} /> Cognitive memory</>}
        title="Capture, consolidate, recall."
        lede="One loop: talk to the agent, let the dream cycle distill durable rules, then serve them back without a model call."
        actions={
          <>
            <Button icon="activity" onClick={() => setStage("activity")}>Activity</Button>
            <Button variant="primary" icon="sparkles" onClick={() => setStage("extract")}>Run dream cycle</Button>
          </>
        }
      />

      <div className="hero-strip" style={{ marginBottom: 18 }}>
        <div>
          <h2>
            A memory layer that gets <em>quieter</em> as it gets smarter.
          </h2>
          <p>
            Capture is cheap. Consolidation is deliberate. Recall is a lookup, not a conversation. Every rule is scoped and
            reviewable before it reaches an agent.
          </p>
        </div>
        <div className="hero-metrics">
          <div className="hero-metric">
            <b>{formatNumber(asArray(lakehouse.data?.sessions).length)}</b>
            <span>Sessions captured</span>
          </div>
          <div className="hero-metric">
            <b>{formatNumber(rulesCount)}</b>
            <span>Beliefs in scope</span>
          </div>
          <div className="hero-metric">
            <b>&lt;10ms</b>
            <span>Direct recall</span>
          </div>
        </div>
      </div>

      <div className="row-between" style={{ marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <Segmented
          ariaLabel="Memory lifecycle stage"
          value={stage}
          onChange={setStage}
          options={STAGES.map((item) => ({ value: item.value, label: item.label, icon: item.icon }))}
        />
        <span className="muted" style={{ fontSize: "var(--text-caption-1)" }}>
          {STAGES.find((item) => item.value === stage)?.copy}
        </span>
      </div>

      <div className="stage" key={stage}>
        {stage === "capture" ? <CaptureStage /> : null}
        {stage === "activity" ? <ActivityStage /> : null}
        {stage === "extract" ? <ExtractStage /> : null}
        {stage === "rules" ? <RulesStage /> : null}
        {stage === "recall" ? <RecallStage /> : null}
      </div>

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 22 }}>
        <Button variant="ghost" iconRight="arrowRight" onClick={() => navigate("/studio")}>
          Open memory studio
        </Button>
      </div>
    </main>
  );
}
