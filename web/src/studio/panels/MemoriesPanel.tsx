import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useToast, useWorkspace } from "../../app/Providers";
import {
  asArray,
  cn,
  copyText,
  firstString,
  formatDate,
  statusTone,
  titleCase,
  truncate,
} from "../../lib/utils";
import type { MemoryRecord, ScopeType, StagedCommit } from "../../lib/types";
import { Icon } from "../../components/Icon";
import {
  Banner,
  Button,
  CodeBlock,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Switch,
  Tag,
  Textarea,
} from "../../components/ui";
import { DetailRow, EmptyPanel, JsonView, type PanelProps } from "../shared";

type ViewMode = "tree" | "list" | "graph";
const SCOPE_TYPES: ScopeType[] = ["ORG", "TEAM", "AGENT", "USER"];

function memKey(memory: MemoryRecord): string {
  return firstString(memory.memory_key, memory.preference_key, memory.title, memory.file_path, "untitled");
}

function memValue(memory: MemoryRecord): string {
  return firstString(memory.memory_value, memory.preference_value, memory.content, memory.crystallized_belief, "");
}

function memBelief(memory: MemoryRecord): string {
  return firstString(memory.crystallized_belief, memory.natural_language_belief, memValue(memory));
}

function commitId(commit: StagedCommit): string {
  return firstString(commit.staged_id, commit.commit_id, commit.id);
}

interface DraftMemory {
  scope_type: ScopeType;
  scope_id: string;
  memory_key: string;
  memory_value: string;
  crystallized_belief: string;
  memory_type: string;
  category: string;
  confidence: number;
  keywords: string;
  sync_immediately: boolean;
}

function emptyDraft(scope: ScopeType, scopeId: string): DraftMemory {
  return {
    scope_type: scope,
    scope_id: scopeId,
    memory_key: "",
    memory_value: "",
    crystallized_belief: "",
    memory_type: "PREFERENCE",
    category: "technical",
    confidence: 0.95,
    keywords: "",
    sync_immediately: false,
  };
}

export function MemoriesPanel({ state, refresh }: PanelProps) {
  const { toast } = useToast();
  const { scopes } = useWorkspace();
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"ALL" | ScopeType>("ALL");
  const [view, setView] = useState<ViewMode>("tree");
  const [selected, setSelected] = useState<MemoryRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MemoryRecord | null>(null);
  const [draft, setDraft] = useState<DraftMemory>(emptyDraft("USER", scopes.user_id));
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MemoryRecord | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<MemoryRecord | null>(null);
  const [promoteScopeType, setPromoteScopeType] = useState<ScopeType>("TEAM");
  const [promoteScopeId, setPromoteScopeId] = useState(scopes.team_id);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const scopesTree = useMemo(() => {
    const tree = state.tree ?? {};
    const grouped: Record<ScopeType, MemoryRecord[]> = { ORG: [], TEAM: [], AGENT: [], USER: [] };
    let any = false;
    for (const scope of SCOPE_TYPES) {
      const records = asArray(tree[scope]);
      if (records.length) any = true;
      grouped[scope] = records;
    }
    if (!any) {
      for (const file of asArray(state.files)) {
        const scope = (String(file.scope_type ?? "USER").toUpperCase() as ScopeType) || "USER";
        if (grouped[scope]) grouped[scope].push(file);
      }
    }
    return grouped;
  }, [state.tree, state.files]);

  const allMemories = useMemo(
    () => SCOPE_TYPES.flatMap((scope) => scopesTree[scope].map((memory) => ({ ...memory, scope_type: scope }))),
    [scopesTree],
  );

  const staged = asArray(state.staged_commits);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allMemories.filter((memory) => {
      if (scopeFilter !== "ALL" && memory.scope_type !== scopeFilter) return false;
      if (!needle) return true;
      return `${memKey(memory)} ${memValue(memory)} ${memBelief(memory)} ${memory.category ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [allMemories, query, scopeFilter]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, MemoryRecord[]>();
    for (const memory of filtered) {
      const category = String(memory.category ?? "uncategorized");
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(memory);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const openEditor = (memory?: MemoryRecord) => {
    if (memory) {
      setEditing(memory);
      setDraft({
        scope_type: (String(memory.scope_type ?? "USER").toUpperCase() as ScopeType) || "USER",
        scope_id: firstString(memory.scope_id, scopes.user_id),
        memory_key: memKey(memory),
        memory_value: memValue(memory),
        crystallized_belief: memBelief(memory),
        memory_type: firstString(memory.memory_type, "PREFERENCE"),
        category: firstString(memory.category, "technical"),
        confidence: typeof memory.confidence === "number" ? memory.confidence : 0.95,
        keywords: Array.isArray(memory.keywords) ? memory.keywords.join(", ") : firstString(memory.keywords, ""),
        sync_immediately: false,
      });
    } else {
      setEditing(null);
      setDraft(emptyDraft(scopeFilter === "ALL" ? "USER" : scopeFilter, scopes.user_id));
    }
    setEditorOpen(true);
  };

  const saveMemory = async () => {
    if (!draft.memory_key.trim() || !draft.memory_value.trim()) {
      toast("error", "Missing fields", "A memory needs a key and a value.");
      return;
    }
    setBusy("save-memory");
    try {
      await api.studio.upsertMemory({
        ...draft,
        keywords: draft.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      });
      toast("success", editing ? "Memory updated" : "Memory created", draft.sync_immediately ? "Written to Spanner." : "Staged for review.");
      setEditorOpen(false);
      await refresh();
    } catch (cause) {
      toast("error", "Could not save memory", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy("delete-memory");
    try {
      await api.studio.deleteMemory({
        scope_type: confirmDelete.scope_type,
        scope_id: confirmDelete.scope_id,
        memory_key: memKey(confirmDelete),
      });
      toast("success", "Memory deleted");
      setConfirmDelete(null);
      setDetailOpen(false);
      await refresh();
    } catch (cause) {
      toast("error", "Delete failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const doCommit = async (id: string) => {
    setBusy(`commit-${id}`);
    try {
      await api.studio.commitStaged(id);
      toast("success", "Commit applied", "The rule is now live.");
      await refresh();
    } catch (cause) {
      toast("error", "Commit failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const doDiscard = async (id: string) => {
    setBusy(`discard-${id}`);
    try {
      await api.studio.discardStaged({ staged_id: id });
      toast("info", "Change discarded");
      await refresh();
    } catch (cause) {
      toast("error", "Discard failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const commitAll = async () => {
    setBusy("commit-all");
    try {
      await api.studio.commitAll();
      toast("success", "All staged changes committed");
      await refresh();
    } catch (cause) {
      toast("error", "Commit all failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const promote = async () => {
    if (!promoteTarget) return;
    setBusy("promote");
    try {
      await api.studio.promoteScope({
        source_scope_type: promoteTarget.scope_type,
        source_scope_id: promoteTarget.scope_id,
        memory_key: memKey(promoteTarget),
        target_scope_type: promoteScopeType,
        target_scope_id: promoteScopeId,
      });
      toast("success", "Memory promoted", `${memKey(promoteTarget)} → ${promoteScopeType}`);
      setPromoteTarget(null);
      await refresh();
    } catch (cause) {
      toast("error", "Promotion failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const exportPack = async () => {
    setBusy("export");
    try {
      const pack = await api.studio.exportMemories({
        user_id: scopes.user_id,
        team_id: scopes.team_id,
        agent_id: scopes.agent_id,
        org_id: scopes.org_id,
        scope_filter: scopeFilter,
      });
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `everstate-memory-pack-${scopeFilter.toLowerCase()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast("success", "Memory pack exported");
    } catch (cause) {
      toast("error", "Export failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const importPack = async () => {
    setBusy("import");
    try {
      const parsed = JSON.parse(importText) as { memories?: MemoryRecord[] };
      if (!Array.isArray(parsed.memories)) throw new Error("JSON must contain a 'memories' array.");
      await api.studio.importMemories({ memories: parsed.memories });
      toast("success", "Memory pack imported", `${parsed.memories.length} records`);
      setImportOpen(false);
      setImportText("");
      await refresh();
    } catch (cause) {
      toast("error", "Import failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const openDetail = (memory: MemoryRecord) => {
    setSelected(memory);
    setDetailOpen(true);
  };

  return (
    <div className="stack">
      {staged.length > 0 ? (
        <div className="surface">
          <div className="surface-head">
            <div>
              <h3>Review queue</h3>
              <p>{staged.length} proposed {staged.length === 1 ? "change" : "changes"} waiting for a human.</p>
            </div>
            <Button size="sm" variant="primary" icon="checkCircle" onClick={commitAll} loading={busy === "commit-all"}>
              Commit all
            </Button>
          </div>
          <div className="stack" style={{ padding: 12 }}>
            {staged.map((commit) => {
              const id = commitId(commit);
              return (
                <div className="memory-card" key={id}>
                  <div className="row-between" style={{ alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <span className="memory-key">{commit.memory_key ?? memKey(commit as MemoryRecord)}</span>
                        <Tag tone={commit.commit_status === "CONFLICT" ? "danger" : commit.commit_status === "NEW" ? "info" : "warning"}>
                          {commit.commit_status ?? "STAGED"}
                        </Tag>
                        <Tag>{commit.scope_type ?? "USER"}</Tag>
                      </div>
                      <div className="memory-meta" style={{ marginTop: 5 }}>
                        <span>{commit.category ?? "preferences"}</span>
                        {commit.source_session_id ? <><span>·</span><span>from {truncate(commit.source_session_id, 24)}</span></> : null}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flex: "none" }}>
                      <Button size="sm" icon="checkCircle" variant="primary" loading={busy === `commit-${id}`} onClick={() => doCommit(id)}>
                        Commit
                      </Button>
                      <Button size="sm" variant="ghost" loading={busy === `discard-${id}`} onClick={() => doDiscard(id)}>
                        Discard
                      </Button>
                    </div>
                  </div>
                  {commit.before_value && commit.before_value !== commit.after_value ? (
                    <div className="grid grid-2" style={{ gap: 8 }}>
                      <div style={{ padding: 8, borderRadius: 8, background: "var(--bg-muted)" }}>
                        <div className="field-label" style={{ marginBottom: 4 }}>Before</div>
                        <div style={{ fontSize: "var(--text-subhead)", color: "var(--fg-muted)" }}>{truncate(commit.before_value, 260)}</div>
                      </div>
                      <div style={{ padding: 8, borderRadius: 8, background: "var(--accent-soft-bg)" }}>
                        <div className="field-label" style={{ marginBottom: 4 }}>After</div>
                        <div style={{ fontSize: "var(--text-subhead)" }}>{truncate(commit.after_value ?? commit.proposed_content, 260)}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="memory-value">{truncate(commit.after_value ?? commit.proposed_content, 500)}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory…" style={{ width: 230 }} />
          <Select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as "ALL" | ScopeType)} style={{ width: 132 }}>
            <option value="ALL">All scopes</option>
            {SCOPE_TYPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
          </Select>
          <Segmented
            ariaLabel="Memory view"
            value={view}
            onChange={setView}
            options={[
              { value: "tree", label: "Categories", icon: "layers" },
              { value: "list", label: "List", icon: "list" },
              { value: "graph", label: "Graph", icon: "share" },
            ]}
          />
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Button icon="fileImport" onClick={() => setImportOpen(true)}>Import</Button>
          <Button icon="fileExport" onClick={exportPack} loading={busy === "export"}>Export</Button>
          <Button variant="primary" icon="add" onClick={() => openEditor()}>New memory</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyPanel
          icon="brain"
          title={allMemories.length === 0 ? "The memory bank is empty" : "No memories match"}
          copy={
            allMemories.length === 0
              ? "Capture a session and run the dream cycle, or create the first rule by hand."
              : "Try a different scope or search term."
          }
          action={
            allMemories.length === 0 ? (
              <Button variant="primary" icon="add" onClick={() => openEditor()}>Create the first memory</Button>
            ) : (
              <Button onClick={() => { setQuery(""); setScopeFilter("ALL"); }}>Clear filters</Button>
            )
          }
        />
      ) : view === "graph" ? (
        <MemoryGraph memories={filtered} onSelect={openDetail} />
      ) : view === "list" ? (
        <div className="surface">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Belief</th>
                  <th style={{ width: 90 }}>Scope</th>
                  <th style={{ width: 110 }}>Category</th>
                  <th style={{ width: 110 }}>State</th>
                  <th style={{ width: 46 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((memory, index) => (
                  <tr key={`${memKey(memory)}-${index}`} onClick={() => openDetail(memory)} style={{ cursor: "pointer" }}>
                    <td>
                      <div className="cell-main mono" style={{ fontSize: "var(--text-caption-1)" }}>{memKey(memory)}</div>
                      <div className="cell-sub">{firstString(memory.scope_id, "")}</div>
                    </td>
                    <td style={{ maxWidth: 420 }}>{truncate(memValue(memory), 180)}</td>
                    <td><Tag>{memory.scope_type}</Tag></td>
                    <td className="muted">{titleCase(memory.category)}</td>
                    <td><Tag tone={statusTone(memory.commit_status ?? "SYNCED")}>{memory.commit_status ?? "SYNCED"}</Tag></td>
                    <td><Icon name="chevronRight" size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="surface-foot">
            <span className="muted" style={{ fontSize: "var(--text-caption-1)" }}>{filtered.length} memories in scope</span>
            <Button size="sm" icon="add" onClick={() => openEditor()}>New memory</Button>
          </div>
        </div>
      ) : (
        <div className="stack">
          {byCategory.map(([category, memories]) => (
            <details className="surface" key={category} open>
              <summary
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "13px 15px",
                  cursor: "pointer",
                  listStyle: "none",
                }}
              >
                <Icon name="folder" size={16} />
                <strong style={{ fontSize: "var(--text-body)" }}>{titleCase(category)}</strong>
                <Tag>{memories.length}</Tag>
                <span className="muted" style={{ marginLeft: "auto", fontSize: "var(--text-caption-1)" }}>
                  {memories.reduce((total, memory) => total + Number(memory.trigger_count ?? 0), 0)} triggers
                </span>
              </summary>
              <div className="stack" style={{ padding: "0 12px 12px" }}>
                {memories.map((memory, index) => (
                  <div
                    className="memory-card"
                    key={`${memKey(memory)}-${index}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetail(memory)}
                    onKeyDown={(event) => event.key === "Enter" && openDetail(memory)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="row-between">
                      <span className="memory-key">{memKey(memory)}</span>
                      <div className="row" style={{ gap: 5 }}>
                        <Tag>{memory.scope_type}</Tag>
                        <Tag tone={statusTone(memory.commit_status ?? "SYNCED")}>{memory.commit_status ?? "SYNCED"}</Tag>
                      </div>
                    </div>
                    <p className="memory-value">{truncate(memValue(memory), 360)}</p>
                    <div className="memory-meta">
                      <span>confidence {typeof memory.confidence === "number" ? memory.confidence.toFixed(2) : "—"}</span>
                      <span>·</span>
                      <span>{Number(memory.use_count ?? memory.trigger_count ?? 0)} recalls</span>
                      <span>·</span>
                      <span>{firstString(memory.memory_type, "PREFERENCE")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      <Drawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={selected ? memKey(selected) : "Memory"}
        description={selected ? `${selected.scope_type} · ${selected.scope_id}` : undefined}
        footer={
          selected ? (
            <>
              <Button variant="ghost" icon="delete" onClick={() => setConfirmDelete(selected)}>Delete</Button>
              <Button variant="secondary" icon="share" onClick={() => { setPromoteTarget(selected); setPromoteScopeType(selected.scope_type === "USER" ? "TEAM" : "ORG"); setPromoteScopeId(selected.scope_type === "USER" ? scopes.team_id : scopes.org_id); }}>Promote</Button>
              <Button variant="primary" icon="pencil" onClick={() => { setDetailOpen(false); openEditor(selected); }}>Edit</Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="stack">
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Tag tone={statusTone(selected.commit_status ?? "SYNCED")}>{selected.commit_status ?? "SYNCED"}</Tag>
              <Tag>{titleCase(selected.category)}</Tag>
              <Tag tone="accent">{firstString(selected.memory_type, "PREFERENCE")}</Tag>
            </div>
            <div>
              <div className="field-label" style={{ marginBottom: 4 }}>Belief</div>
              <p style={{ fontSize: "var(--text-callout)", lineHeight: 1.55 }}>{memBelief(selected)}</p>
            </div>
            <div>
              <div className="field-label" style={{ marginBottom: 4 }}>Directive</div>
              <p className="muted" style={{ fontSize: "var(--text-subhead)", whiteSpace: "pre-wrap" }}>{memValue(selected)}</p>
            </div>
            <div>
              <DetailRow label="Confidence">{typeof selected.confidence === "number" ? selected.confidence.toFixed(2) : "—"}</DetailRow>
              <DetailRow label="Triggers">{String(selected.trigger_count ?? selected.support_count ?? 0)}</DetailRow>
              <DetailRow label="Source">{firstString(selected.source_session_id, "—")}</DetailRow>
              <DetailRow label="Updated">{formatDate(selected.updated_at ?? selected.last_updated)}</DetailRow>
              <DetailRow label="Path">{firstString(selected.file_path, "—")}</DetailRow>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" icon="checkCircle" onClick={async () => {
                const id = firstString(selected.file_id, selected.file_path, memKey(selected));
                try {
                  await api.studio.usefulness(id, { rating: "helpful", session_id: firstString(selected.source_session_id, "studio") });
                  toast("success", "Marked helpful");
                } catch (cause) {
                  toast("error", "Rating failed", cause instanceof Error ? cause.message : undefined);
                }
              }}>Helpful</Button>
              <Button size="sm" icon="alert" onClick={async () => {
                const id = firstString(selected.file_id, selected.file_path, memKey(selected));
                try {
                  await api.studio.usefulness(id, { rating: "unhelpful", session_id: firstString(selected.source_session_id, "studio") });
                  toast("info", "Marked unhelpful");
                } catch (cause) {
                  toast("error", "Rating failed", cause instanceof Error ? cause.message : undefined);
                }
              }}>Unhelpful</Button>
              <Button size="sm" variant="ghost" icon="copy" onClick={async () => {
                await copyText(JSON.stringify(selected, null, 2));
                toast("success", "Memory copied");
              }}>Copy</Button>
            </div>
            <details>
              <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--text-subhead)" }}>Raw record</summary>
              <JsonView value={selected} />
            </details>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? "Edit memory" : "New memory"}
        description="A memory is a key, a directive and the belief it supports. Keys are unique inside a scope."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveMemory} loading={busy === "save-memory"}>
              {editing ? "Save changes" : "Create memory"}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Scope type">
            <Select value={draft.scope_type} onChange={(event) => setDraft({ ...draft, scope_type: event.target.value as ScopeType })}>
              {SCOPE_TYPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
            </Select>
          </Field>
          <Field label="Scope id">
            <Input value={draft.scope_id} onChange={(event) => setDraft({ ...draft, scope_id: event.target.value })} />
          </Field>
          <Field label="Memory key" className="span-2" hint="Stable, snake_case identifier, e.g. python_package_manager.">
            <Input value={draft.memory_key} onChange={(event) => setDraft({ ...draft, memory_key: event.target.value })} placeholder="python_package_manager" />
          </Field>
          <Field label="Directive" className="span-2" hint="What the agent must do or remember.">
            <Textarea value={draft.memory_value} onChange={(event) => setDraft({ ...draft, memory_value: event.target.value })} placeholder="Always run Python tests with `uv run pytest`." />
          </Field>
          <Field label="Crystallized belief" className="span-2" hint="Optional natural-language synthesis shown in recall.">
            <Textarea value={draft.crystallized_belief} onChange={(event) => setDraft({ ...draft, crystallized_belief: event.target.value })} />
          </Field>
          <Field label="Memory type">
            <Select value={draft.memory_type} onChange={(event) => setDraft({ ...draft, memory_type: event.target.value })}>
              <option value="PREFERENCE">Preference</option>
              <option value="PROCEDURAL_SKILL">Procedural skill</option>
              <option value="INVARIANT_GUARDRAIL">Invariant guardrail</option>
            </Select>
          </Field>
          <Field label="Category">
            <Input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
          </Field>
          <Field label="Confidence">
            <Input type="number" step="0.01" min="0" max="1" value={draft.confidence} onChange={(event) => setDraft({ ...draft, confidence: Number(event.target.value) })} />
          </Field>
          <Field label="Keywords">
            <Input value={draft.keywords} onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} placeholder="python, pytest, uv" />
          </Field>
          <div className="span-2">
            <Switch checked={draft.sync_immediately} onChange={(next) => setDraft({ ...draft, sync_immediately: next })} label="Write directly to Spanner (skip review)" />
          </div>
        </div>
        {editing ? (
          <Banner tone="warning">
            <Icon name="alert" size={16} />
            Staged edits are reversible from the review queue. Direct writes go live immediately.
          </Banner>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(promoteTarget)}
        onClose={() => setPromoteTarget(null)}
        title="Promote memory"
        description={promoteTarget ? `Copy ${memKey(promoteTarget)} into a broader scope.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromoteTarget(null)}>Cancel</Button>
            <Button variant="primary" icon="share" onClick={promote} loading={busy === "promote"}>Promote</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Target scope">
            <Select value={promoteScopeType} onChange={(event) => {
              const next = event.target.value as ScopeType;
              setPromoteScopeType(next);
              setPromoteScopeId(next === "ORG" ? scopes.org_id : next === "TEAM" ? scopes.team_id : next === "AGENT" ? scopes.agent_id : scopes.user_id);
            }}>
              <option value="TEAM">Team</option>
              <option value="ORG">Organization</option>
              <option value="AGENT">Agent</option>
              <option value="USER">User</option>
            </Select>
          </Field>
          <Field label="Target id">
            <Input value={promoteScopeId} onChange={(event) => setPromoteScopeId(event.target.value)} />
          </Field>
        </div>
        <Banner>
          <Icon name="info" size={16} />
          Promotion keeps the source memory and adds a copy at the target scope. Conflicts are resolved by the category policy.
        </Banner>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import memory pack"
        description="Paste an exported Everstate pack. Existing keys are updated, new keys are created."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="fileImport" onClick={importPack} loading={busy === "import"}>Import pack</Button>
          </>
        }
      >
        <Textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder='{"memories":[{"memory_key":"python_package_manager","memory_value":"Use uv"}]}'
          style={{ minBlockSize: 220, fontFamily: "var(--font-mono)", fontSize: "var(--text-caption-1)" }}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this memory?"
        copy={confirmDelete ? `${memKey(confirmDelete)} will be removed from ${confirmDelete.scope_type} scope.` : undefined}
        confirmLabel="Delete"
        destructive
        busy={busy === "delete-memory"}
        onConfirm={doDelete}
      />
    </div>
  );
}

function MemoryGraph({ memories, onSelect }: { memories: MemoryRecord[]; onSelect: (memory: MemoryRecord) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const width = 760;
  const height = 380;
  const center = { x: width / 2, y: height / 2 };
  const scopeRadius: Record<string, number> = { ORG: 160, TEAM: 120, AGENT: 82, USER: 44 };

  const nodes = SCOPE_TYPES.flatMap((scope) => {
    const records = memories.filter((memory) => memory.scope_type === scope);
    return records.map((memory, index) => {
      const radius = scopeRadius[scope];
      const angle = (index / Math.max(records.length, 1)) * Math.PI * 2 + (scope === "TEAM" ? 0.4 : scope === "USER" ? 0.9 : 0);
      return {
        memory,
        key: `${scope}-${memKey(memory)}-${index}`,
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
        radius,
        angle,
        size: Math.min(14, 6 + Math.sqrt(Number(memory.trigger_count ?? memory.support_count ?? 1)) * 2),
      };
    });
  });

  return (
    <div className="surface">
      <div className="surface-head">
        <div>
          <h3>Memory constellation</h3>
          <p>Orbit distance is scope breadth. Node size is recall frequency. Click a node to inspect it.</p>
        </div>
        <div className="chip-row">
          {SCOPE_TYPES.map((scope) => <Tag key={scope} tone={scope === "USER" ? "accent" : "neutral"}>{scope}</Tag>)}
        </div>
      </div>
      <div style={{ overflow: "auto", padding: 8 }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: 560, display: "block" }} role="img" aria-label="Memory constellation">
          <defs>
            <radialGradient id="graph-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--accent-solid-from)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent-solid-from)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={center.x} cy={center.y} r="180" fill="url(#graph-glow)" />
          {[44, 82, 120, 160].map((radius) => (
            <circle key={radius} cx={center.x} cy={center.y} r={radius} fill="none" stroke="var(--border)" strokeDasharray="2 5" />
          ))}
          {nodes.map((node) => (
            <line
              key={`line-${node.key}`}
              x1={center.x}
              y1={center.y}
              x2={node.x}
              y2={node.y}
              stroke="var(--border)"
              strokeWidth="1"
              opacity={hover === node.key ? 0.8 : 0.35}
            />
          ))}
          <circle cx={center.x} cy={center.y} r="13" fill="var(--accent-solid-from)" />
          <text x={center.x} y={center.y + 4} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="600">EVERSTATE</text>
          {nodes.map((node) => (
            <g
              key={node.key}
              transform={`translate(${node.x} ${node.y})`}
              onClick={() => onSelect(node.memory)}
              onMouseEnter={() => setHover(node.key)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            >
              <circle
                r={node.size + (hover === node.key ? 3 : 0)}
                fill={node.memory.scope_type === "USER" ? "var(--accent-soft-fg)" : "var(--fg-muted)"}
                opacity={hover && hover !== node.key ? 0.55 : 0.9}
                stroke="var(--panel)"
                strokeWidth="2"
              />
              {hover === node.key ? (
                <g transform={`translate(${node.x > width - 180 ? -150 : 14} ${-8})`}>
                  <rect width="150" height="34" rx="7" fill="var(--panel)" stroke="var(--border)" />
                  <text x="8" y="14" fontSize="9" fill="var(--fg-muted)">{node.memory.scope_type}</text>
                  <text x="8" y="26" fontSize="10" fill="var(--fg)" fontWeight="600">{truncate(memKey(node.memory), 22)}</text>
                </g>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
      <div className="surface-foot">
        <span className="muted" style={{ fontSize: "var(--text-caption-1)" }}>{nodes.length} nodes · click to inspect</span>
        <div className="row" style={{ gap: 6 }}>
          <Tag tone="accent">USER</Tag>
          <Tag>AGENT</Tag>
          <Tag>TEAM</Tag>
          <Tag>ORG</Tag>
        </div>
      </div>
    </div>
  );
}
