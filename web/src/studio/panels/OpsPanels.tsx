import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useResource } from "../../lib/hooks";
import { useToast, useWorkspace } from "../../app/Providers";
import { asArray, cn, firstString, formatDate, formatNumber, statusTone, titleCase, truncate } from "../../lib/utils";
import type { Extractor, IngestConfig, SecurityPolicy, StudioCategory, StudioEntity } from "../../lib/types";
import { Icon } from "../../components/Icon";
import {
  Banner,
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Stat,
  Switch,
  Tag,
  Textarea,
} from "../../components/ui";
import { DetailRow, EmptyPanel, ErrorNote, JsonView, type PanelProps } from "../shared";

const SCOPES = ["ORG", "TEAM", "AGENT", "USER"] as const;

function prettyWriteMode(value: string): string {
  const mode = value.toUpperCase();
  if (mode.includes("STAGE")) return "Staged";
  if (mode.includes("DIRECT") || mode.includes("WRITE_THROUGH")) return "Direct";
  return titleCase(value);
}

/* ------------------------------------------------------------------ entities */

export function EntitiesPanel({ state, refresh }: PanelProps) {
  const { toast } = useToast();
  const { scopes } = useWorkspace();
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StudioEntity | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StudioEntity | null>(null);
  const [draft, setDraft] = useState({
    scope_type: "USER",
    entity_id: "",
    display_name: "",
    handle: "",
    parent_id: scopes.team_id,
    description: "",
    tags: "",
  });

  const entities = asArray(state.entities);
  const scopeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const scope of SCOPES) {
      for (const memory of asArray(state.tree?.[scope])) {
        const key = firstString(memory.scope_id, "");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [state.tree]);
  const filtered = entities.filter((entity) => {
    if (filter !== "ALL" && String(entity.scope_type).toUpperCase() !== filter) return false;
    if (!query.trim()) return true;
    return `${entity.display_name ?? entity.name ?? ""} ${entity.entity_id ?? entity.scope_id ?? ""} ${entity.handle ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });

  const openEditor = (entity?: StudioEntity) => {
    if (entity) {
      setEditing(entity);
      setDraft({
        scope_type: String(entity.scope_type ?? "USER").toUpperCase(),
        entity_id: firstString(entity.entity_id, entity.scope_id, entity.id, ""),
        display_name: firstString(entity.display_name, entity.name, ""),
        handle: firstString(entity.handle, entity.owner, ""),
        parent_id: firstString(entity.parent_id, scopes.team_id),
        description: firstString(entity.description, ""),
        tags: asArray(entity.tags).join(", "),
      });
    } else {
      setEditing(null);
      setDraft({
        scope_type: "USER",
        entity_id: "",
        display_name: "",
        handle: "",
        parent_id: scopes.team_id,
        description: "",
        tags: "",
      });
    }
    setOpen(true);
  };

  const save = async () => {
    if (!draft.entity_id.trim() && !draft.display_name.trim()) {
      toast("error", "Missing identity", "Give the entity an id or a display name.");
      return;
    }
    setBusy("save");
    try {
      await api.studio.upsertEntity({
        ...draft,
        entity_id: draft.entity_id.trim() || undefined,
        tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      toast("success", editing ? "Entity updated" : "Entity created");
      setOpen(false);
      await refresh();
    } catch (cause) {
      toast("error", "Could not save entity", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy("delete");
    try {
      const type = String(confirmDelete.scope_type ?? "USER");
      const id = firstString(confirmDelete.entity_id, confirmDelete.scope_id, confirmDelete.id);
      await api.studio.deleteEntity(type, id);
      toast("success", "Entity deleted");
      setConfirmDelete(null);
      await refresh();
    } catch (cause) {
      toast("error", "Delete failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="grid grid-4">
        {SCOPES.map((scope) => (
          <Stat
            key={scope}
            label={titleCase(scope)}
            value={formatNumber(entities.filter((entity) => String(entity.scope_type).toUpperCase() === scope).length)}
            meta={scope === "USER" ? "personal scopes" : scope === "TEAM" ? "shared teams" : scope === "AGENT" ? "agent identities" : "top-level orgs"}
            icon={scope === "USER" ? "user" : scope === "TEAM" ? "team" : scope === "AGENT" ? "robot" : "layers"}
          />
        ))}
      </div>

      <div className="row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8 }}>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entities…" style={{ width: 230 }} />
          <Select value={filter} onChange={(event) => setFilter(event.target.value)} style={{ width: 130 }}>
            <option value="ALL">All scopes</option>
            {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
          </Select>
        </div>
        <Button variant="primary" icon="add" onClick={() => openEditor()}>New entity</Button>
      </div>

      <div className="surface">
        <div className="surface-head">
          <div>
            <h3>Scope hierarchy</h3>
            <p>Entities own memories. Parent links decide how policies and recalls cascade.</p>
          </div>
          <Tag tone="accent">{filtered.length} entities</Tag>
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon="users" title="No entities" copy="Create an org, team, agent or user scope to attach memories to." action={<Button variant="primary" icon="add" onClick={() => openEditor()}>New entity</Button>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th style={{ width: 90 }}>Scope</th>
                  <th>Parent</th>
                  <th>Owner</th>
                  <th className="num" style={{ width: 80 }}>Memories</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((entity, index) => {
                  const id = firstString(entity.entity_id, entity.scope_id, entity.id, `entity-${index}`);
                  return (
                    <tr key={id}>
                      <td>
                        <div className="cell-main">{firstString(entity.display_name, entity.name, id)}</div>
                        <div className="cell-sub mono">{id}</div>
                      </td>
                      <td><Tag>{String(entity.scope_type ?? "USER")}</Tag></td>
                      <td className="muted mono" style={{ fontSize: "var(--text-caption-1)" }}>{firstString(entity.parent_id, entity.parent_path, entity.parentPath, "—")}</td>
                      <td className="muted">{firstString(entity.handle, entity.owner, "—")}</td>
                      <td className="num">{formatNumber(scopeCounts.get(firstString(entity.scope_id, entity.entity_id, entity.id)) ?? entity.memory_count ?? 0)}</td>
                      <td>
                        <div className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                          <Button size="sm" variant="ghost" icon="pencil" onClick={() => openEditor(entity)} aria-label="Edit entity" />
                          <Button size="sm" variant="ghost" icon="delete" onClick={() => setConfirmDelete(entity)} aria-label="Delete entity" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit entity" : "New scope entity"}
        description="A stable scope id is what memories, policies and recalls point at."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={busy === "save"}>{editing ? "Save entity" : "Create entity"}</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Scope type">
            <Select value={draft.scope_type} onChange={(event) => setDraft({ ...draft, scope_type: event.target.value })}>
              {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
            </Select>
          </Field>
          <Field label="Entity id" hint="e.g. team:platform-eng">
            <Input value={draft.entity_id} onChange={(event) => setDraft({ ...draft, entity_id: event.target.value })} placeholder={`${draft.scope_type.toLowerCase()}:handle`} />
          </Field>
          <Field label="Display name">
            <Input value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} />
          </Field>
          <Field label="Handle">
            <Input value={draft.handle} onChange={(event) => setDraft({ ...draft, handle: event.target.value })} placeholder="@platform" />
          </Field>
          <Field label="Parent scope" className="span-2">
            <Input value={draft.parent_id} onChange={(event) => setDraft({ ...draft, parent_id: event.target.value })} placeholder="team:platform-eng" />
          </Field>
          <Field label="Description" className="span-2">
            <Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </Field>
          <Field label="Tags" className="span-2" hint="Comma separated.">
            <Input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this entity?"
        copy="Memories remain in storage but the scope stops resolving until an entity with the same id is recreated."
        confirmLabel="Delete entity"
        destructive
        busy={busy === "delete"}
        onConfirm={remove}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- categories */

export function CategoriesPanel({ state, refresh }: PanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StudioCategory | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StudioCategory | null>(null);
  const [draft, setDraft] = useState({
    category_id: "",
    label: "",
    description: "",
    color: "#2662d9",
    default_scope: "USER",
    default_memory_type: "PREFERENCE",
    default_match_mode: "HYBRID_COSINE_AND_KEYWORD",
    cosine_threshold: 0.72,
    retention_ttl: "365d",
    conflict_policy: "latest_wins",
    auto_extract: true,
  });

  const categories = asArray(state.categories);
  const memoryCounts = useMemo(() => {
    const all = ["ORG", "TEAM", "AGENT", "USER"].flatMap((scope) => asArray(state.tree?.[scope as keyof typeof state.tree]));
    const records = all.length ? all : asArray(state.files);
    const counts = new Map<string, { memories: number; triggers: number }>();
    for (const memory of records) {
      const key = String(memory.category ?? "").toLowerCase();
      const entry = counts.get(key) ?? { memories: 0, triggers: 0 };
      entry.memories += 1;
      entry.triggers += Number(memory.trigger_count ?? 0);
      counts.set(key, entry);
    }
    return counts;
  }, [state.tree, state.files]);

  const openEditor = (category?: StudioCategory) => {
    if (category) {
      setEditing(category);
      setDraft({
        category_id: firstString(category.category_id, category.id, category.slug, ""),
        label: firstString(category.label, category.name, ""),
        description: firstString(category.description, ""),
        color: firstString(category.color, "#2662d9"),
        default_scope: String(category.default_scope ?? "USER"),
        default_memory_type: firstString(category.default_memory_type, "PREFERENCE"),
        default_match_mode: firstString(category.default_match_mode, category.match_mode, "HYBRID_COSINE_AND_KEYWORD"),
        cosine_threshold: Number(category.cosine_threshold ?? category.default_threshold ?? 0.72),
        retention_ttl: firstString(category.retentionTtl, category.retention_ttl, "365d"),
        conflict_policy: firstString(category.conflictPolicy, category.conflict_policy, "latest_wins"),
        auto_extract: Boolean(category.auto_extract ?? true),
      });
    } else {
      setEditing(null);
      setDraft({
        category_id: "",
        label: "",
        description: "",
        color: "#2662d9",
        default_scope: "USER",
        default_memory_type: "PREFERENCE",
        default_match_mode: "HYBRID_COSINE_AND_KEYWORD",
        cosine_threshold: 0.72,
        retention_ttl: "365d",
        conflict_policy: "latest_wins",
        auto_extract: true,
      });
    }
    setOpen(true);
  };

  const save = async () => {
    if (!draft.category_id.trim() && !draft.label.trim()) {
      toast("error", "Missing name", "Give the category an id or a label.");
      return;
    }
    setBusy("save");
    try {
      await api.studio.upsertCategory(draft);
      toast("success", editing ? "Category updated" : "Category created");
      setOpen(false);
      await refresh();
    } catch (cause) {
      toast("error", "Could not save category", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy("delete");
    try {
      const id = firstString(confirmDelete.category_id, confirmDelete.id, confirmDelete.slug);
      await api.studio.deleteCategory(id);
      toast("success", "Category deleted");
      setConfirmDelete(null);
      await refresh();
    } catch (cause) {
      toast("error", "Delete failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Tag tone="accent">{categories.length} categories</Tag>
          <Tag>{formatNumber(Array.from(memoryCounts.values()).reduce((total, entry) => total + entry.memories, 0))} memories</Tag>
          <Tag>{formatNumber(Array.from(memoryCounts.values()).reduce((total, entry) => total + entry.triggers, 0))} triggers</Tag>
        </div>
        <Button variant="primary" icon="add" onClick={() => openEditor()}>New category</Button>
      </div>

      {categories.length === 0 ? (
        <EmptyPanel icon="tag" title="No categories" copy="Categories decide retention, conflict policy and default recall thresholds." action={<Button variant="primary" icon="add" onClick={() => openEditor()}>Create a category</Button>} />
      ) : (
        <div className="grid grid-2">
          {categories.map((category, index) => {
            const id = firstString(category.category_id, category.id, category.slug, `category-${index}`);
            const color = firstString(category.color, "var(--accent-text)");
            const live = memoryCounts.get(id.toLowerCase());
            const memories = live?.memories ?? Number(category.memory_count ?? 0);
            const triggers = live?.triggers ?? Number(category.total_triggers ?? 0);
            return (
              <div className="category-card" key={id}>
                <div className="row-between" style={{ alignItems: "flex-start" }}>
                  <div className="row" style={{ gap: 9, minWidth: 0 }}>
                    <span className="category-swatch" style={{ background: color }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <strong style={{ fontSize: "var(--text-body)" }}>{firstString(category.label, category.name, id)}</strong>
                        <span className="mono muted" style={{ fontSize: 10 }}>{id}</span>
                      </div>
                      <p className="muted" style={{ fontSize: "var(--text-caption-1)", marginTop: 2 }}>
                        {truncate(firstString(category.description, category.folder_path, "No description"), 140)}
                      </p>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 2 }}>
                    <Button size="sm" variant="ghost" icon="pencil" onClick={() => openEditor(category)} aria-label="Edit category" />
                    <Button size="sm" variant="ghost" icon="delete" onClick={() => setConfirmDelete(category)} aria-label="Delete category" />
                  </div>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <Tag tone="info">{memories} memories</Tag>
                  <Tag>{triggers} triggers</Tag>
                  <Tag tone="accent">{String(category.default_scope ?? "USER")}</Tag>
                  <Tag>{String(category.default_memory_type ?? "PREFERENCE").replace(/_/g, " ").toLowerCase()}</Tag>
                </div>
                <div className="category-meta">
                  <span>threshold <b>{Number(category.cosine_threshold ?? category.default_threshold ?? 0.72).toFixed(2)}</b></span>
                  <span>retention <b>{firstString(category.retentionTtl, category.retention_ttl, "—")}</b></span>
                  <span>conflict <b>{firstString(category.conflictPolicy, category.conflict_policy, "—")}</b></span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit category" : "New memory category"}
        description="Taxonomy controls what is extracted, how long it lives and who wins when beliefs conflict."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={busy === "save"}>{editing ? "Save category" : "Create category"}</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Category id" hint="snake_case, unique">
            <Input value={draft.category_id} onChange={(event) => setDraft({ ...draft, category_id: event.target.value })} placeholder="cost_governance" />
          </Field>
          <Field label="Label">
            <Input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="Cost governance" />
          </Field>
          <Field label="Description" className="span-2">
            <Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </Field>
          <Field label="Color">
            <Input value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} placeholder="#2662d9" />
          </Field>
          <Field label="Default scope">
            <Select value={draft.default_scope} onChange={(event) => setDraft({ ...draft, default_scope: event.target.value })}>
              {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
            </Select>
          </Field>
          <Field label="Memory type">
            <Select value={draft.default_memory_type} onChange={(event) => setDraft({ ...draft, default_memory_type: event.target.value })}>
              <option value="PREFERENCE">Preference</option>
              <option value="PROCEDURAL_SKILL">Procedural skill</option>
              <option value="INVARIANT_GUARDRAIL">Invariant guardrail</option>
            </Select>
          </Field>
          <Field label="Match mode">
            <Select value={draft.default_match_mode} onChange={(event) => setDraft({ ...draft, default_match_mode: event.target.value })}>
              <option value="HYBRID_COSINE_AND_KEYWORD">Hybrid cosine + keyword</option>
              <option value="ALWAYS_PINNED">Always pinned</option>
              <option value="KEYWORD_ONLY">Keyword only</option>
              <option value="COSINE_ONLY">Cosine only</option>
            </Select>
          </Field>
          <Field label="Cosine threshold">
            <Input type="number" min="0.1" max="1" step="0.01" value={draft.cosine_threshold} onChange={(event) => setDraft({ ...draft, cosine_threshold: Number(event.target.value) })} />
          </Field>
          <Field label="Retention">
            <Input value={draft.retention_ttl} onChange={(event) => setDraft({ ...draft, retention_ttl: event.target.value })} placeholder="365d" />
          </Field>
          <Field label="Conflict policy">
            <Select value={draft.conflict_policy} onChange={(event) => setDraft({ ...draft, conflict_policy: event.target.value })}>
              <option value="latest_wins">Latest wins</option>
              <option value="highest_confidence">Highest confidence</option>
              <option value="manual_review">Manual review</option>
              <option value="scope_precedence">Scope precedence</option>
            </Select>
          </Field>
          <div className="span-2">
            <Switch checked={draft.auto_extract} onChange={(next) => setDraft({ ...draft, auto_extract: next })} label="Auto-extract candidates into this category" />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this category?"
        copy="Memories keep their category slug, but it will no longer resolve to a taxon."
        confirmLabel="Delete category"
        destructive
        busy={busy === "delete"}
        onConfirm={remove}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- ingest */

export function IngestPanel({ state, refresh }: PanelProps) {
  const { toast } = useToast();
  const { scopes } = useWorkspace();
  const config = state.ingest_config ?? {};
  const [draft, setDraft] = useState<IngestConfig>({ ...config });
  useEffect(() => {
    setDraft({ ...config });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ingest_config]);
  const [raw, setRaw] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [service, setService] = useState({ name: "", connector_type: "BIGQUERY", endpoint_uri: "/api/studio/ingest", write_mode: "staged", pii_redaction_mode: "STRICT_HASH" });
  const [live, setLive] = useState({ message: "", session_id: `live-${Date.now().toString(36)}` });
  const rawResource = useResource(() => api.studio.raw(25), []);

  const services = asArray(state.ingest_services);
  const events = asArray(state.live_events);

  const saveConfig = async () => {
    setBusy("config");
    try {
      await api.studio.saveIngestConfig(draft);
      toast("success", "Ingest config saved");
      await refresh();
    } catch (cause) {
      toast("error", "Save failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const addService = async () => {
    setBusy("service");
    try {
      await api.studio.upsertService({ action: "upsert_service", ...service });
      toast("success", "Service added");
      setServiceOpen(false);
      await refresh();
    } catch (cause) {
      toast("error", "Could not add service", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const ingestLive = async () => {
    if (!live.message.trim()) return;
    setBusy("live");
    try {
      await api.studio.upsertService({
        action: "ingest_event",
        session_id: live.session_id,
        message: live.message,
        user_id: scopes.user_id,
        agent_id: scopes.agent_id,
      });
      toast("success", "Event ingested");
      setLive({ ...live, message: "" });
      await refresh();
    } catch (cause) {
      toast("error", "Live ingest failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="grid grid-rail">
        <div className="surface">
          <div className="surface-head">
            <div>
              <h3>Source configuration</h3>
              <p>Where activity comes from, how it is scrubbed and when extraction runs.</p>
            </div>
            <Button variant="primary" icon="checkCircle" onClick={saveConfig} loading={busy === "config"}>Save config</Button>
          </div>
          <div className="surface-body">
            <div className="form-grid">
              <Field label="Source type">
                <Select value={String(draft.source_type ?? "BIGQUERY_LAKEHOUSE")} onChange={(event) => setDraft({ ...draft, source_type: event.target.value })}>
                  <option value="BIGQUERY_LAKEHOUSE">BigQuery lakehouse</option>
                  <option value="ANTIGRAVITY_TRANSCRIPT">Local agent transcript</option>
                  <option value="RAW_JSONL">Raw JSONL</option>
                </Select>
              </Field>
              <Field label="Source stream">
                <Input value={String(draft.source_stream ?? "")} onChange={(event) => setDraft({ ...draft, source_stream: event.target.value })} />
              </Field>
              <Field label="BigQuery table" className="span-2">
                <Input value={String(draft.bq_dataset_table ?? "")} onChange={(event) => setDraft({ ...draft, bq_dataset_table: event.target.value })} />
              </Field>
              <Field label="Lookback (hours)">
                <Input type="number" value={Number(draft.lookback_hours ?? 24)} onChange={(event) => setDraft({ ...draft, lookback_hours: Number(event.target.value) })} />
              </Field>
              <Field label="Chunk window (turns)">
                <Input type="number" value={Number(draft.chunk_window_turns ?? 10)} onChange={(event) => setDraft({ ...draft, chunk_window_turns: Number(event.target.value) })} />
              </Field>
              <Field label="Min confidence">
                <Input type="number" step="0.01" min="0" max="1" value={Number(draft.min_confidence_gate ?? 0.85)} onChange={(event) => setDraft({ ...draft, min_confidence_gate: Number(event.target.value) })} />
              </Field>
              <Field label="Dedup distance">
                <Input type="number" step="0.01" min="0" max="1" value={Number(draft.dedup_cosine_threshold ?? 0.18)} onChange={(event) => setDraft({ ...draft, dedup_cosine_threshold: Number(event.target.value) })} />
              </Field>
              <div className="span-2 row" style={{ gap: 18, flexWrap: "wrap" }}>
                <Switch checked={Boolean(draft.pii_scrubbing)} onChange={(next) => setDraft({ ...draft, pii_scrubbing: next })} label="PII scrubbing" />
                <Switch checked={Boolean(draft.auto_extract_signals)} onChange={(next) => setDraft({ ...draft, auto_extract_signals: next })} label="Auto-extract signals" />
                <Switch checked={Boolean(draft.auto_stage_extracted)} onChange={(next) => setDraft({ ...draft, auto_stage_extracted: next })} label="Auto-stage candidates" />
              </div>
            </div>
            {asArray(draft.signal_detectors).length ? (
              <div className="chip-row" style={{ marginTop: 14 }}>
                {asArray(draft.signal_detectors).map((detector) => <Tag key={String(detector)} tone="info">{String(detector).replace(/_/g, " ").toLowerCase()}</Tag>)}
              </div>
            ) : null}
          </div>
        </div>

        <div className="surface rail-card">
          <div className="row-between">
            <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Live ingest</span>
            <Tag tone="success" dot>endpoint</Tag>
          </div>
          <p className="muted" style={{ fontSize: "var(--text-caption-1)" }}>
            Push a turn into the active session to watch extraction react.
          </p>
          <Field label="Message">
            <Textarea value={live.message} onChange={(event) => setLive({ ...live, message: event.target.value })} placeholder="I always deploy to Cloud Run in us-central1." style={{ minBlockSize: 80 }} />
          </Field>
          <Field label="Session">
            <Input value={live.session_id} onChange={(event) => setLive({ ...live, session_id: event.target.value })} />
          </Field>
          <Button size="sm" variant="primary" icon="zap" onClick={ingestLive} loading={busy === "live"}>Ingest event</Button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="surface">
          <div className="surface-head">
            <div>
              <h3>Ingest services</h3>
              <p>Connectors writing into the memory pipeline.</p>
            </div>
            <Button size="sm" icon="add" onClick={() => setServiceOpen(true)}>Add</Button>
          </div>
          {services.length === 0 ? (
            <EmptyState icon="upload" title="No services" copy="Add a BigQuery, transcript or webhook connector." />
          ) : (
            <div className="stack" style={{ padding: 12 }}>
              {services.map((item, index) => (
                <div className="memory-card" key={firstString(item.service_id, item.id, index)}>
                  <div className="row-between">
                    <span className="row" style={{ gap: 7 }}>
                      <Icon name="cloud" size={15} />
                      <strong style={{ fontSize: "var(--text-subhead)" }}>{firstString(item.name, item.service_id, "Service")}</strong>
                    </span>
                    <Tag tone={statusTone(item.status ?? "ACTIVE")}>{firstString(item.status, "ACTIVE")}</Tag>
                  </div>
                  <div className="memory-meta">
                    <span>{firstString(item.connector_type, "—")}</span>
                    <span>·</span>
                    <span>{firstString(item.write_mode, "staged")}</span>
                    <span>·</span>
                    <span>{firstString(item.pii_redaction_mode, "—")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="surface">
          <div className="surface-head">
            <div>
              <h3>Raw telemetry</h3>
              <p>Latest events pulled from the lakehouse.</p>
            </div>
            <Button size="sm" icon="refresh" onClick={() => rawResource.refresh()} loading={rawResource.loading}>Refresh</Button>
          </div>
          <div className="surface-body">
            <ErrorNote error={rawResource.error} />
            {rawResource.loading && raw.length === 0 ? <Spinner label="Loading telemetry" /> : (
              <div className="stack" style={{ maxHeight: 320, overflowY: "auto" }}>
                {asArray(rawResource.data?.events as Array<Record<string, unknown>>).length === 0 ? (
                  <EmptyState icon="database" title="No events" copy="Events appear after a session is ingested." />
                ) : (
                  asArray(rawResource.data?.events as Array<Record<string, unknown>>).map((event, index) => (
                    <div key={index} className="memory-card">
                      <div className="row-between">
                        <span className="memory-key">{firstString(event.event_type, event.type, "event")}</span>
                        <span className="muted" style={{ fontSize: 10 }}>{formatDate(firstString(event.timestamp, event.created_at))}</span>
                      </div>
                      <p className="memory-value">{truncate(firstString(event.message, event.content, JSON.stringify(event)), 240)}</p>
                    </div>
                  ))
                )}
              </div>
            )}
            {events.length ? (
              <p className="muted" style={{ fontSize: "var(--text-caption-1)", marginTop: 10 }}>{events.length} live events buffered in the bootstrap snapshot.</p>
            ) : null}
          </div>
        </div>
      </div>

      <Modal
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        title="Add ingest service"
        description="A connector that writes into the memory pipeline."
        footer={
          <>
            <Button variant="ghost" onClick={() => setServiceOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="add" onClick={addService} loading={busy === "service"}>Add service</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Name" className="span-2">
            <Input value={service.name} onChange={(event) => setService({ ...service, name: event.target.value })} placeholder="Production transcripts" />
          </Field>
          <Field label="Connector">
            <Select value={service.connector_type} onChange={(event) => setService({ ...service, connector_type: event.target.value })}>
              <option value="BIGQUERY">BigQuery</option>
              <option value="WEBHOOK">Webhook</option>
              <option value="TRANSCRIPT">Transcript</option>
              <option value="JSONL">JSONL</option>
            </Select>
          </Field>
          <Field label="Write mode">
            <Select value={service.write_mode} onChange={(event) => setService({ ...service, write_mode: event.target.value })}>
              <option value="staged">Staged</option>
              <option value="direct">Direct</option>
            </Select>
          </Field>
          <Field label="Endpoint" className="span-2">
            <Input value={service.endpoint_uri} onChange={(event) => setService({ ...service, endpoint_uri: event.target.value })} />
          </Field>
          <Field label="PII policy">
            <Select value={service.pii_redaction_mode} onChange={(event) => setService({ ...service, pii_redaction_mode: event.target.value })}>
              <option value="STRICT_HASH">Strict hash</option>
              <option value="MASK">Mask</option>
              <option value="NONE">None</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------------- extractors */

export function ExtractorsPanel({ state, refresh }: PanelProps) {
  const { toast } = useToast();
  const { sessionId } = useWorkspace();
  const extractors = asArray(state.extractors);
  const [selectedId, setSelectedId] = useState<string | null>(extractors[0]?.extractor_id ?? extractors[0]?.id ?? null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Extractor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runSession, setRunSession] = useState(sessionId);
  const [tune, setTune] = useState("");
  const [tuneReply, setTuneReply] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    extractor_id: "",
    name: "",
    target_category: "technical",
    target_scope: "USER",
    model: "gemini-3.8-flash",
    trigger_event: "USER_PROMPT",
    confidence_gate: 0.85,
    write_mode: "staged",
    system_prompt: "",
  });

  const selected = extractors.find((extractor) => firstString(extractor.extractor_id, extractor.id) === selectedId) ?? extractors[0] ?? null;

  const openEditor = (extractor?: Extractor) => {
    if (extractor) {
      setEditing(extractor);
      setDraft({
        extractor_id: firstString(extractor.extractor_id, extractor.id, ""),
        name: firstString(extractor.name, ""),
        target_category: firstString(extractor.target_category, extractor.targetCategory, "technical"),
        target_scope: firstString(extractor.target_scope, asArray(extractor.targetScopes as string[])[0], "USER"),
        model: firstString(extractor.model, "gemini-3.8-flash"),
        trigger_event: firstString(extractor.trigger_event, "USER_PROMPT"),
        confidence_gate: Number(extractor.confidence_gate ?? extractor.confidenceThreshold ?? 0.85),
        write_mode: firstString(extractor.write_mode, extractor.writeMode, "staged"),
        system_prompt: firstString(extractor.system_prompt, extractor.systemPrompt, ""),
      });
    } else {
      setEditing(null);
      setDraft({
        extractor_id: "",
        name: "",
        target_category: "technical",
        target_scope: "USER",
        model: "gemini-3.8-flash",
        trigger_event: "USER_PROMPT",
        confidence_gate: 0.85,
        write_mode: "staged",
        system_prompt: "",
      });
    }
    setOpen(true);
  };

  const save = async () => {
    setBusy("save");
    try {
      await api.studio.upsertExtractor(draft);
      toast("success", editing ? "Extractor updated" : "Extractor created");
      setOpen(false);
      await refresh();
    } catch (cause) {
      toast("error", "Could not save extractor", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!selected) return;
    setBusy("run");
    try {
      const data = await api.studio.runExtractor(firstString(selected.extractor_id, selected.id), { session_id: runSession, write_mode: "staged" });
      toast("success", "Extractor ran", `${asArray(data.candidates as Array<Record<string, unknown>>).length} candidates found.`);
      await refresh();
    } catch (cause) {
      toast("error", "Extractor failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const tunePrompt = async () => {
    if (!selected || !tune.trim()) return;
    setBusy("tune");
    try {
      const data = await api.studio.chatExtractor(firstString(selected.extractor_id, selected.id), { message: tune, apply_updates: true });
      setTuneReply(firstString(data.response, data.reply, data.message, JSON.stringify(data)));
      toast("success", "Extractor prompt tuned");
      setTune("");
      await refresh();
    } catch (cause) {
      toast("error", "Tune failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 6 }}>
          <Tag tone="accent">{extractors.length} extractors</Tag>
          <Tag>{extractors.filter((extractor) => ["ACTIVE", "RUNNING"].includes(String(extractor.status ?? "ACTIVE").toUpperCase())).length} active</Tag>
        </div>
        <Button variant="primary" icon="add" onClick={() => openEditor()}>New extractor</Button>
      </div>

      {extractors.length === 0 ? (
        <EmptyPanel icon="cpu" title="No extractors" copy="An extractor is a prompt + policy that turns turns into candidate memories." action={<Button variant="primary" icon="add" onClick={() => openEditor()}>Create an extractor</Button>} />
      ) : (
        <div className="extractor-layout">
          <div className="surface extractor-list">
            {extractors.map((extractor, index) => {
              const id = firstString(extractor.extractor_id, extractor.id, `ext-${index}`);
              return (
                <button
                  key={id}
                  className={cn("extractor-row", id === selectedId && "is-active")}
                  onClick={() => setSelectedId(id)}
                >
                  <span className="row-between">
                    <strong style={{ fontSize: "var(--text-subhead)" }}>{firstString(extractor.name, id)}</strong>
                    <Tag tone={statusTone(extractor.status ?? "ACTIVE")}>{firstString(extractor.status, "ACTIVE")}</Tag>
                  </span>
                  <span className="muted mono" style={{ fontSize: 10 }}>{id}</span>
                  <span className="row" style={{ gap: 5, marginTop: 2 }}>
                    <Tag>{firstString(extractor.target_category, "—")}</Tag>
                    <Tag tone="info">{firstString(extractor.model, "model")}</Tag>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="surface extractor-detail">
            {selected ? (
              <>
                <div className="surface-head">
                  <div>
                    <h3>{firstString(selected.name, selected.extractor_id, "Extractor")}</h3>
                    <p>{firstString(selected.target_category, selected.targetCategory, "—")} · {firstString(selected.target_scope, asArray(selected.targetScopes as string[])[0], "USER")} · {firstString(selected.trigger_event, "event")}</p>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" icon="pencil" onClick={() => openEditor(selected)}>Edit</Button>
                    <Button size="sm" variant="primary" icon="play" onClick={run} loading={busy === "run"}>Run</Button>
                  </div>
                </div>
                <div className="surface-body stack">
                  <div className="grid grid-3">
                    <Stat label="Confidence gate" value={Number(selected.confidence_gate ?? selected.confidenceThreshold ?? 0.85).toFixed(2)} icon="filter" />
                    <Stat label="Write mode" value={prettyWriteMode(firstString(selected.write_mode, selected.writeMode, "staged"))} icon="database" />
                    <Stat label="Model" value={truncate(firstString(selected.model, "—"), 16)} icon="ai" />
                  </div>
                  <Field label="Run on session">
                    <div className="row">
                      <Input value={runSession} onChange={(event) => setRunSession(event.target.value)} />
                      <Button icon="play" onClick={run} loading={busy === "run"}>Run</Button>
                    </div>
                  </Field>
                  <div>
                    <div className="field-label" style={{ marginBottom: 4 }}>System prompt</div>
                    <pre className="code-block" style={{ maxHeight: 220 }}>{firstString(selected.system_prompt, selected.systemPrompt, "No compiled prompt stored yet.")}</pre>
                  </div>
                  <div>
                    <div className="field-label" style={{ marginBottom: 6 }}>Tune with plain English</div>
                    <div className="row" style={{ alignItems: "flex-end" }}>
                      <Textarea value={tune} onChange={(event) => setTune(event.target.value)} placeholder="Only extract rules that mention a concrete command." style={{ minBlockSize: 64 }} />
                      <Button variant="primary" icon="magic" onClick={tunePrompt} loading={busy === "tune"}>Tune</Button>
                    </div>
                    {tuneReply ? <Banner tone="success">{tuneReply}</Banner> : null}
                  </div>
                  <details>
                    <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--text-subhead)" }}>Human parameters</summary>
                    <JsonView value={selected.human_params ?? selected.humanParams ?? {}} />
                  </details>
                  <details>
                    <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--text-subhead)" }}>Raw extractor</summary>
                    <JsonView value={selected} />
                  </details>
                </div>
              </>
            ) : (
              <EmptyState icon="cpu" title="Select an extractor" />
            )}
          </div>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit extractor" : "New extractor"}
        description="Extractors turn observed turns into reviewable candidate memories."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={busy === "save"}>{editing ? "Save extractor" : "Create extractor"}</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Extractor id">
            <Input value={draft.extractor_id} onChange={(event) => setDraft({ ...draft, extractor_id: event.target.value })} placeholder="ext-preference" />
          </Field>
          <Field label="Name">
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="Target category">
            <Input value={draft.target_category} onChange={(event) => setDraft({ ...draft, target_category: event.target.value })} />
          </Field>
          <Field label="Target scope">
            <Select value={draft.target_scope} onChange={(event) => setDraft({ ...draft, target_scope: event.target.value })}>
              {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
            </Select>
          </Field>
          <Field label="Model">
            <Input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
          </Field>
          <Field label="Trigger event">
            <Input value={draft.trigger_event} onChange={(event) => setDraft({ ...draft, trigger_event: event.target.value })} />
          </Field>
          <Field label="Confidence gate">
            <Input type="number" min="0" max="1" step="0.01" value={draft.confidence_gate} onChange={(event) => setDraft({ ...draft, confidence_gate: Number(event.target.value) })} />
          </Field>
          <Field label="Write mode">
            <Select value={draft.write_mode} onChange={(event) => setDraft({ ...draft, write_mode: event.target.value })}>
              <option value="staged">Staged</option>
              <option value="direct">Direct</option>
            </Select>
          </Field>
          <Field label="System prompt" className="span-2">
            <Textarea value={draft.system_prompt} onChange={(event) => setDraft({ ...draft, system_prompt: event.target.value })} style={{ minBlockSize: 140 }} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------------- backend */

export function BackendPanel({ state, refresh }: PanelProps) {
  const { toast } = useToast();
  const { scopes } = useWorkspace();
  const statusResource = useResource(() => api.studio.backendStatus(), []);
  const backend = statusResource.data ?? state.backend ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [testWrite, setTestWrite] = useState({
    source_agent: "PreferenceAgent",
    scope_type: "USER",
    scope_id: scopes.user_id,
    category: "workflow",
    memory_key: "live_agent_rule",
    after_value: "",
  });
  const [seedOpen, setSeedOpen] = useState(false);

  const subsystems = asArray(backend.subsystems as Array<Record<string, unknown>>);
  const mutations = asArray(
    (backend.agent_mutation_log ?? backend.direct_agent_mutations ?? backend.mutations) as Array<Record<string, unknown>>,
  );
  const syncPipelines = asArray(backend.sync_pipelines as Array<Record<string, unknown>>);
  const onlineStore = (backend.online_store ?? {}) as Record<string, unknown>;
  const offlineStore = (backend.offline_store ?? {}) as Record<string, unknown>;

  const runTestWrite = async () => {
    if (!testWrite.after_value.trim()) {
      toast("error", "Nothing to write", "Add a value for the test memory.");
      return;
    }
    setBusy("write");
    try {
      await api.studio.testAgentWrite(testWrite);
      toast("success", "Test write succeeded");
      setTestWrite({ ...testWrite, after_value: "" });
      await statusResource.refresh();
      await refresh();
    } catch (cause) {
      toast("error", "Test write failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (id: string) => {
    setBusy(`rollback-${id}`);
    try {
      await api.studio.rollback(id);
      toast("success", "Mutation rolled back");
      await statusResource.refresh();
    } catch (cause) {
      toast("error", "Rollback failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Health" value={firstString(backend.status, "OK")} icon="checkCircle" accent />
        <Stat label="Subsystems" value={formatNumber(subsystems.length)} icon="server" meta="connected surfaces" />
        <Stat label="Sync pipelines" value={formatNumber(syncPipelines.length)} icon="refresh" meta="CDC + attribution" />
        <Stat label="Direct writes" value={formatNumber(mutations.length)} icon="activity" meta="audit trail" />
      </div>

      <div className="grid grid-rail">
        <div className="surface">
          <div className="surface-head">
            <div>
              <h3>Write-back backend</h3>
              <p>The contract between the workbench and the live preference store.</p>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" icon="refresh" onClick={() => statusResource.refresh()} loading={statusResource.loading}>Check</Button>
              <Button size="sm" variant="primary" icon="upload" onClick={async () => {
                setBusy("sync");
                try {
                  await api.studio.backendSync();
                  toast("success", "Backend synced");
                  await statusResource.refresh();
                } catch (cause) {
                  toast("error", "Sync failed", cause instanceof Error ? cause.message : undefined);
                } finally {
                  setBusy(null);
                }
              }} loading={busy === "sync"}>Sync</Button>
            </div>
          </div>
          <div className="surface-body">
            <ErrorNote error={statusResource.error} />
            <div>
              <DetailRow label="Online store">{firstString(onlineStore.engine, onlineStore.name, "Cloud Spanner")}</DetailRow>
              <DetailRow label="Offline store">{firstString(offlineStore.engine, offlineStore.name, "BigQuery")}</DetailRow>
              <DetailRow label="Instance">{firstString(onlineStore.instance_uri, backend.instance, "—")}</DetailRow>
              <DetailRow label="Dataset">{firstString(offlineStore.dataset, backend.database, "—")}</DetailRow>
              <DetailRow label="Synced memories">{formatNumber(onlineStore.active_synced_memories ?? 0)}</DetailRow>
              <DetailRow label="Pending commits">{formatNumber(onlineStore.pending_staged_commits ?? 0)}</DetailRow>
              <DetailRow label="CDC lag">{firstString(offlineStore.cdc_lag_seconds, "—")}s</DetailRow>
              <DetailRow label="Mode">{firstString(backend.status, "connected")}</DetailRow>
            </div>
            {subsystems.length ? (
              <div className="grid grid-2" style={{ marginTop: 12 }}>
                {subsystems.map((subsystem, index) => (
                  <div className="memory-card" key={firstString(subsystem.id, index)}>
                    <div className="row-between" style={{ alignItems: "flex-start" }}>
                      <strong style={{ fontSize: "var(--text-subhead)", lineHeight: 1.35 }}>{firstString(subsystem.name, subsystem.type, "Subsystem")}</strong>
                      <Tag tone={statusTone(subsystem.status ?? "HEALTHY")}>{firstString(subsystem.status, "HEALTHY")}</Tag>
                    </div>
                    <div className="memory-meta">
                      <span>{firstString(subsystem.type, "—")}</span>
                      <span>·</span>
                      <span>{firstString(subsystem.region, "global")}</span>
                      <span>·</span>
                      <span>p95 {firstString(subsystem.latencyP95, "—")}</span>
                    </div>
                    <p className="muted mono" style={{ fontSize: 10, overflowWrap: "anywhere" }}>{firstString(subsystem.resourceUri, subsystem.tablesOrModels, "")}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <details style={{ marginTop: 12 }}>
              <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--text-subhead)" }}>Raw status</summary>
              <JsonView value={backend} />
            </details>
          </div>
        </div>

        <div className="surface rail-card">
          <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Agent test write</span>
          <Field label="Source agent">
            <Input value={testWrite.source_agent} onChange={(event) => setTestWrite({ ...testWrite, source_agent: event.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label="Scope">
              <Select value={testWrite.scope_type} onChange={(event) => setTestWrite({ ...testWrite, scope_type: event.target.value })}>
                {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
              </Select>
            </Field>
            <Field label="Key">
              <Input value={testWrite.memory_key} onChange={(event) => setTestWrite({ ...testWrite, memory_key: event.target.value })} />
            </Field>
          </div>
          <Field label="After value">
            <Textarea value={testWrite.after_value} onChange={(event) => setTestWrite({ ...testWrite, after_value: event.target.value })} placeholder="Always pin the region to us-central1." style={{ minBlockSize: 70 }} />
          </Field>
          <Button size="sm" variant="primary" icon="play" onClick={runTestWrite} loading={busy === "write"}>Run test write</Button>
        </div>
      </div>

      <div className="surface">
        <div className="surface-head">
          <div>
            <h3>Mutation audit</h3>
            <p>Every write is reversible. Roll back a mutation to restore the previous value.</p>
          </div>
          <Tag>{mutations.length} entries</Tag>
        </div>
        {mutations.length === 0 ? (
          <EmptyState icon="database" title="No mutations recorded" copy="Run a test write or commit a memory to populate the audit trail." />
        ) : (
          <div className="stack" style={{ padding: 12 }}>
            {mutations.map((mutation, index) => {
              const id = firstString(mutation.mutation_id, mutation.id, index);
              return (
                <div className="memory-card" key={id}>
                  <div className="row-between">
                    <span className="row" style={{ gap: 7 }}>
                      <Tag tone={statusTone(mutation.status ?? "SUCCEEDED")}>{firstString(mutation.status, "SUCCEEDED")}</Tag>
                      <strong className="mono" style={{ fontSize: "var(--text-caption-1)" }}>{truncate(id, 28)}</strong>
                    </span>
                    <Button size="sm" variant="ghost" icon="rotate" onClick={() => rollback(id)} loading={busy === `rollback-${id}`}>
                      Roll back
                    </Button>
                  </div>
                  <div className="memory-meta">
                    <span>{firstString(mutation.actor, mutation.agentPrincipal, mutation.source_agent, "agent")}</span>
                    <span>·</span>
                    <span>{firstString(mutation.scope, mutation.scope_id, "—")}</span>
                    <span>·</span>
                    <span>{formatDate(firstString(mutation.timestamp, mutation.created_at))}</span>
                  </div>
                  <p className="memory-value" style={{ whiteSpace: "pre-wrap" }}>
                    {truncate(firstString(mutation.new_belief_snapshot, mutation.after_value, mutation.targetPath, mutation.file_path, "No snapshot"), 300)}
                  </p>
                  <div className="memory-meta">
                    <span className="mono">{firstString(mutation.tool_name, mutation.operation, "mutation")}</span>
                    <span>·</span>
                    <span>{firstString(mutation.governanceMode, mutation.write_mode, "STAGED")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="surface">
        <div className="surface-head">
          <div>
            <h3>Sandbox tools</h3>
            <p>Load demo data or start again from zero.</p>
          </div>
          <Button icon="rocket" onClick={() => setSeedOpen(true)}>Seed demo</Button>
        </div>
        <div className="surface-body">
          <Banner>
            <Icon name="info" size={16} />
            Seeding writes a multi-scope demo dataset (org, team, agent, user) so the hierarchy can be explored end to end.
          </Banner>
        </div>
      </div>

      <ConfirmDialog
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        title="Seed the demo dataset?"
        copy="This adds demo memories at every scope. Existing keys are updated in place."
        confirmLabel="Seed demo"
        busy={busy === "seed"}
        onConfirm={async () => {
          setBusy("seed");
          try {
            await api.studio.seedDemo({ ...scopes });
            toast("success", "Demo data seeded");
            setSeedOpen(false);
            await refresh();
          } catch (cause) {
            toast("error", "Seed failed", cause instanceof Error ? cause.message : undefined);
          } finally {
            setBusy(null);
          }
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- security */

export function SecurityPanel({ state, refresh }: PanelProps) {
  const { toast } = useToast();
  const { scopes } = useWorkspace();
  const policies = asArray(state.security_policies);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sim, setSim] = useState({
    principal: "agent:code-reviewer",
    action: "READ",
    scope: "USER",
    target_scope_id: scopes.user_id,
    classification: "INTERNAL",
    file_path: "user/preferences/python_tooling.md",
  });
  const [simResult, setSimResult] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState({
    role_name: "",
    principal: "agent:code-reviewer",
    target_scope_id: scopes.org_id,
    applies_to_descendants: true,
    allowed_scopes: "ORG,TEAM,AGENT,USER",
    allowed_actions: "READ,STAGE,COMMIT",
    path_prefix: "*",
    effect: "ALLOW",
    max_classification: "INTERNAL",
    pii_redaction_level: "STRICT_HASH",
  });

  const save = async () => {
    setBusy("save");
    try {
      await api.studio.upsertPolicy({
        ...draft,
        role_name: draft.role_name || "Untitled role",
        allowed_scopes: draft.allowed_scopes.split(",").map((value) => value.trim()).filter(Boolean),
        allowed_actions: draft.allowed_actions.split(",").map((value) => value.trim()).filter(Boolean),
      });
      toast("success", "Policy saved");
      setOpen(false);
      await refresh();
    } catch (cause) {
      toast("error", "Could not save policy", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const simulate = async () => {
    setBusy("simulate");
    try {
      const data = await api.studio.simulate(sim);
      setSimResult(data);
      toast(data.allowed ? "success" : "info", data.allowed ? "Access allowed" : "Access denied");
    } catch (cause) {
      toast("error", "Simulation failed", cause instanceof Error ? cause.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="grid grid-rail">
        <div className="surface">
          <div className="surface-head">
            <div>
              <h3>RBAC policies</h3>
              <p>Principals, scopes, actions and classification ceilings.</p>
            </div>
            <Button variant="primary" icon="add" onClick={() => setOpen(true)}>New policy</Button>
          </div>
          {policies.length === 0 ? (
            <EmptyState icon="shield" title="No policies" copy="Without a policy the memory backend falls back to deny-by-default." action={<Button variant="primary" icon="add" onClick={() => setOpen(true)}>Create a policy</Button>} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Principal</th>
                    <th style={{ width: 120 }}>Effect</th>
                    <th>Scope</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((policy: SecurityPolicy, index) => (
                    <tr key={firstString(policy.policy_id, policy.id, index)}>
                      <td>
                        <div className="cell-main">{firstString(policy.role_name, policy.role, "Policy")}</div>
                        <div className="cell-sub mono">{firstString(policy.target_scope_id, policy.name, "global")}</div>
                      </td>
                      <td className="mono" style={{ fontSize: "var(--text-caption-1)" }}>{firstString(policy.principal, "—")}</td>
                      <td>
                        <Tag tone={firstString(policy.effect, "ALLOW") === "DENY" ? "danger" : "success"}>{firstString(policy.effect, "ALLOW")}</Tag>
                        <div className="cell-sub">{firstString(policy.max_classification, "INTERNAL")}</div>
                      </td>
                      <td className="muted">
                        {firstString(policy.scopeType, asArray(policy.allowed_scopes).join(" · "), "—")}
                        <div className="cell-sub mono">{truncate(firstString(policy.treeCondition, policy.scope_path_pattern, ""), 30)}</div>
                      </td>
                      <td className="muted" style={{ maxWidth: 180 }}>
                        {(() => {
                          const actions = Object.entries((policy.permissions ?? {}) as Record<string, unknown>)
                            .filter(([, allowed]) => Boolean(allowed))
                            .map(([action]) => action);
                          const list = actions.length ? actions : asArray(policy.allowed_actions);
                          return list.length ? `${list.slice(0, 3).join(" · ")}${list.length > 3 ? ` +${list.length - 3}` : ""}` : "—";
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="surface-foot">
            <span className="muted" style={{ fontSize: "var(--text-caption-1)" }}>{policies.length} rules · cascade is resolved at read time</span>
          </div>
        </div>

        <div className="surface rail-card">
          <span className="section-title" style={{ fontSize: "var(--text-body)" }}>Simulate access</span>
          <Field label="Principal">
            <Input value={sim.principal} onChange={(event) => setSim({ ...sim, principal: event.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label="Action">
              <Select value={sim.action} onChange={(event) => setSim({ ...sim, action: event.target.value })}>
                {["READ", "STAGE", "COMMIT", "WRITE", "ROLLBACK", "DELETE"].map((action) => <option key={action} value={action}>{action}</option>)}
              </Select>
            </Field>
            <Field label="Scope">
              <Select value={sim.scope} onChange={(event) => setSim({ ...sim, scope: event.target.value })}>
                {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
              </Select>
            </Field>
            <Field label="Classification">
              <Select value={sim.classification} onChange={(event) => setSim({ ...sim, classification: event.target.value })}>
                {["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"].map((level) => <option key={level} value={level}>{level}</option>)}
              </Select>
            </Field>
            <Field label="Target id">
              <Input value={sim.target_scope_id} onChange={(event) => setSim({ ...sim, target_scope_id: event.target.value })} />
            </Field>
          </div>
          <Field label="File path">
            <Input value={sim.file_path} onChange={(event) => setSim({ ...sim, file_path: event.target.value })} />
          </Field>
          <Button size="sm" variant="primary" icon="shield" onClick={simulate} loading={busy === "simulate"}>Simulate</Button>
          {simResult ? (
            <div className={cn("banner", simResult.allowed ? "success" : "error")}>
              <Icon name={simResult.allowed ? "checkCircle" : "cancel"} size={16} />
              <div>
                <strong>{simResult.allowed ? "Allowed" : "Denied"}</strong>
                <div style={{ fontSize: "var(--text-caption-1)" }}>{firstString(simResult.reason, simResult.message, "Evaluated against the active policies.")}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New RBAC policy"
        description="Policies cascade to descendants unless the path prefix restricts them."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="shield" onClick={save} loading={busy === "save"}>Create policy</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Role name">
            <Input value={draft.role_name} onChange={(event) => setDraft({ ...draft, role_name: event.target.value })} placeholder="Read-only reviewer" />
          </Field>
          <Field label="Effect">
            <Select value={draft.effect} onChange={(event) => setDraft({ ...draft, effect: event.target.value })}>
              <option value="ALLOW">Allow</option>
              <option value="DENY">Deny</option>
            </Select>
          </Field>
          <Field label="Principal" className="span-2">
            <Input value={draft.principal} onChange={(event) => setDraft({ ...draft, principal: event.target.value })} />
          </Field>
          <Field label="Target scope id">
            <Input value={draft.target_scope_id} onChange={(event) => setDraft({ ...draft, target_scope_id: event.target.value })} />
          </Field>
          <Field label="Max classification">
            <Select value={draft.max_classification} onChange={(event) => setDraft({ ...draft, max_classification: event.target.value })}>
              {["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"].map((level) => <option key={level} value={level}>{level}</option>)}
            </Select>
          </Field>
          <Field label="Allowed scopes" hint="Comma separated">
            <Input value={draft.allowed_scopes} onChange={(event) => setDraft({ ...draft, allowed_scopes: event.target.value })} />
          </Field>
          <Field label="Allowed actions" hint="Comma separated">
            <Input value={draft.allowed_actions} onChange={(event) => setDraft({ ...draft, allowed_actions: event.target.value })} />
          </Field>
          <Field label="Path prefix">
            <Input value={draft.path_prefix} onChange={(event) => setDraft({ ...draft, path_prefix: event.target.value })} />
          </Field>
          <Field label="PII redaction">
            <Select value={draft.pii_redaction_level} onChange={(event) => setDraft({ ...draft, pii_redaction_level: event.target.value })}>
              <option value="STRICT_HASH">Strict hash</option>
              <option value="MASK">Mask</option>
              <option value="NONE">None</option>
            </Select>
          </Field>
          <div className="span-2">
            <Switch checked={draft.applies_to_descendants} onChange={(next) => setDraft({ ...draft, applies_to_descendants: next })} label="Cascade to descendant scopes" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
