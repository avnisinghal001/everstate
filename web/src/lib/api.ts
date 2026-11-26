import type {
  AntigravitySession,
  AuthConfig,
  BackendStatus,
  EvalCase,
  EvolveResult,
  Extractor,
  IngestConfig,
  IngestService,
  JobRecord,
  JobSnapshot,
  LakehouseSession,
  LogRecord,
  MemoryRecord,
  PreferenceRecord,
  Scorecard,
  ScopeIds,
  SecurityPolicy,
  StagedCommit,
  StudioCategory,
  StudioEntity,
  StudioSession,
  StudioState,
  TreePayload,
} from "./types";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const entries = Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return path;
  const params = new URLSearchParams();
  for (const [key, value] of entries) params.set(key, String(value));
  return `${path}?${params.toString()}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type") && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch (cause) {
    throw new ApiError(0, "Cannot reach the Everstate service. Is the backend running?", cause);
  }

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("everstate:unauthorized"));
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? (payload as Record<string, unknown>).detail
        : payload;
    const message =
      typeof detail === "string"
        ? detail
        : detail
          ? JSON.stringify(detail)
          : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, detail);
  }

  return payload as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const api = {
  auth: {
    config: () => request<AuthConfig>("/api/auth/config"),
    me: () => request<{ email?: string; authenticated?: boolean }>("/api/auth/me"),
    session: (idToken: string) => post<{ email?: string; status?: string }>("/api/auth/session", { idToken }),
    logout: () => {
      window.location.href = "/logout";
    },
  },

  chat: {
    interview: (body: { user_id: string; session_id: string; prompt: string }) =>
      post<{ response?: string; [key: string]: unknown }>("/api/interview/query", body),
    recall: (body: { user_id: string; session_id: string; prompt: string }) =>
      post<{
        response?: string;
        source?: string;
        latency_ms?: number;
        recalled_memories?: unknown[];
        [key: string]: unknown;
      }>("/api/preference/query", body),
    extract: (body: { user_id: string; intent_or_question?: string; limit?: number; include_random?: boolean }) =>
      post<Record<string, unknown>>("/api/preference/extract_memories", body),
    inject: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/preference/inject", body),
    mcp: (tool_name: string, args: Record<string, unknown>) =>
      post<Record<string, unknown>>("/api/mcp/execute", { tool_name, arguments: args }),
  },

  capture: {
    antigravitySessions: () => request<{ sessions?: AntigravitySession[] }>("/api/antigravity/sessions"),
    antigravityTurns: (id: string) =>
      request<{ turns?: Array<Record<string, unknown>> }>(`/api/antigravity/sessions/${encodeURIComponent(id)}/turns`),
    ingestAntigravity: (body: { user_id: string; session_id: string }) =>
      post<{ status?: string; turns_ingested?: number; detail?: string }>("/api/antigravity/ingest", body),
    ingestTranscript: (body: { user_id: string; session_id: string; content: string; format?: string }) =>
      post<{ status?: string; turns_ingested?: number; detail?: string }>("/api/telemetry/ingest_transcript", body),
    lakehouseSessions: () => request<{ sessions?: LakehouseSession[] }>("/api/lakehouse/sessions"),
    logs: (sessionId: string) =>
      request<{ logs?: LogRecord[] }>(`/api/logs/${encodeURIComponent(sessionId)}`),
    harvest: (body: {
      user_id: string;
      session_id?: string;
      session_ids?: string[];
      multi_session?: boolean;
      session_type?: string;
    }) => {
      const endpoint = body.multi_session ? "/api/harvest/multi" : "/api/harvest";
      return post<{
        status?: string;
        preferences_synced?: number;
        sessions_processed?: number;
        detail?: string;
        [key: string]: unknown;
      }>(endpoint, body);
    },
    promptTemplate: () => request<Record<string, unknown>>("/api/harvest/prompt-template"),
  },

  memory: {
    preferences: (userId: string) =>
      request<{ preferences?: PreferenceRecord[] }>(`/api/spanner/preferences/${encodeURIComponent(userId)}`),
    guardrails: (userId: string) =>
      request<{ guardrails?: PreferenceRecord[] }>(`/api/spanner/guardrails/${encodeURIComponent(userId)}`),
    summaries: (userId: string) =>
      request<{ summaries?: Array<Record<string, unknown>> }>(`/api/spanner/summaries/${encodeURIComponent(userId)}`),
  },

  studio: {
    state: () => request<StudioState>("/api/studio/state"),
    reset: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/reset", body),
    seedDemo: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/seed-demo", body),

    sessions: (query?: Query) => request<{ sessions?: StudioSession[]; count?: number }>(withQuery("/api/studio/sessions", query)),
    summarizeSession: (id: string, auto_stage_candidates = true) =>
      post<Record<string, unknown>>(`/api/studio/sessions/${encodeURIComponent(id)}/summarize`, {
        auto_stage_candidates,
      }),
    rateSession: (id: string, body: Record<string, unknown>) =>
      post<Record<string, unknown>>(`/api/studio/sessions/${encodeURIComponent(id)}/helpfulness`, body),

    tree: (query?: ScopeIds) =>
      request<TreePayload>(
        withQuery("/api/studio/tree", {
          user_id: query?.user_id,
          team_id: query?.team_id,
          agent_id: query?.agent_id,
        }),
      ),
    files: () => request<TreePayload>("/api/studio/files"),
    stageFile: (body: Record<string, unknown>) => post<TreePayload>("/api/studio/files/stage", body),
    commitFile: (commitId: string) =>
      post<TreePayload>(`/api/studio/files/commit/${encodeURIComponent(commitId)}`),
    discardFile: (commitId: string) =>
      post<TreePayload>(`/api/studio/files/discard/${encodeURIComponent(commitId)}`),
    commitAll: () => post<TreePayload>("/api/studio/files/commit-all"),
    commitStaged: (staged_id: string) => post<TreePayload>("/api/studio/tree/commit", { staged_id }),
    discardStaged: (body: { staged_id?: string; discard_all?: boolean }) =>
      post<TreePayload>("/api/studio/tree/discard", body),
    deleteNode: (body: Record<string, unknown>) =>
      request<TreePayload>("/api/studio/tree/node", { method: "DELETE", body: JSON.stringify(body) }),
    usefulness: (fileId: string, body: Record<string, unknown>) =>
      post<Record<string, unknown>>(`/api/studio/files/${encodeURIComponent(fileId)}/usefulness`, body),

    upsertMemory: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/memories/upsert", body),
    deleteMemory: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/memories/delete", body),
    exportMemories: (query?: Record<string, string>) => request<Record<string, unknown>>(withQuery("/api/studio/memories/export", query)),
    importMemories: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/memories/import", body),

    scopes: (query?: Record<string, string>) => request<Record<string, unknown>>(withQuery("/api/studio/scopes", query)),
    promoteScope: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/scopes/promote", body),
    consensus: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/scopes/consensus", body),
    feedback: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/feedback", body),

    evalCases: () => request<{ cases?: EvalCase[]; count?: number }>("/api/studio/eval/cases"),
    generateEval: (body: { topic: string; count: number }) =>
      post<{ generated_cases?: EvalCase[]; cases?: EvalCase[] }>("/api/studio/eval/generate", body),
    runEval: (body: { alpha_quality_weight: number; config?: Record<string, unknown> }) =>
      post<Scorecard>("/api/studio/eval/run", body),
    retest: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/scenarios/retest", body),

    evolve: (body: Record<string, unknown>) => post<EvolveResult>("/api/studio/evolve/run", body),
    evolveArchive: () => request<EvolveResult>("/api/studio/evolve/archive"),
    promoteChampion: (body: Record<string, unknown> = {}) => post<Record<string, unknown>>("/api/studio/evolve/promote", body),

    syncStatus: () => request<Record<string, unknown>>("/api/studio/sync/status"),
    syncPush: (body: ScopeIds) => post<Record<string, unknown>>("/api/studio/sync/push", body),

    ingestConfig: () => request<{ config?: IngestConfig } & IngestConfig>("/api/studio/ingest/config"),
    saveIngestConfig: (body: IngestConfig) => post<Record<string, unknown>>("/api/studio/ingest/config", body),
    raw: (limit = 25) => request<Record<string, unknown>>(withQuery("/api/studio/ingest/raw", { limit })),
    rawStreamUrl: (limit = 25) => withQuery("/api/studio/ingest/raw-stream", { limit }),
    services: () => request<{ services?: IngestService[]; live_events?: Array<Record<string, unknown>> }>("/api/studio/ingest/services"),
    upsertService: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/ingest/services", body),

    categories: () => request<{ categories?: StudioCategory[]; count?: number }>("/api/studio/categories"),
    upsertCategory: (body: Record<string, unknown>) => post<{ categories?: StudioCategory[] }>("/api/studio/categories", body),
    deleteCategory: (id: string) =>
      request<Record<string, unknown>>(`/api/studio/categories/${encodeURIComponent(id)}`, { method: "DELETE" }),

    entities: (query?: Query) => request<{ entities?: StudioEntity[]; authenticated_email?: string }>(withQuery("/api/studio/entities", query)),
    upsertEntity: (body: Record<string, unknown>) => post<{ entities?: StudioEntity[] }>("/api/studio/entities", body),
    deleteEntity: (scopeType: string, scopeId: string) =>
      request<{ entities?: StudioEntity[] }>(
        `/api/studio/entities/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}`,
        { method: "DELETE" },
      ),

    extractors: () => request<{ extractors?: Extractor[] }>("/api/studio/extractors"),
    upsertExtractor: (body: Record<string, unknown>) => post<{ extractors?: Extractor[] }>("/api/studio/extractors", body),
    runExtractor: (id: string, body: Record<string, unknown>) =>
      post<Record<string, unknown>>(`/api/studio/extractors/${encodeURIComponent(id)}/run`, body),
    chatExtractor: (id: string, body: Record<string, unknown>) =>
      post<Record<string, unknown>>(`/api/studio/extractors/${encodeURIComponent(id)}/chat`, body),

    extractTrajectories: (body: Record<string, unknown>) =>
      post<Record<string, unknown>>("/api/studio/trajectories/extract", body),

    backend: () => request<BackendStatus>("/api/studio/backend"),
    backendStatus: () => request<BackendStatus>("/api/studio/backend/status"),
    testAgentWrite: (body: Record<string, unknown>) =>
      post<Record<string, unknown>>("/api/studio/backend/test-agent-write", body),
    rollback: (mutationId: string) =>
      post<Record<string, unknown>>(`/api/studio/backend/mutations/${encodeURIComponent(mutationId)}/rollback`),
    backendSync: () => post<Record<string, unknown>>("/api/studio/backend/sync"),

    securityPolicies: () => request<{ policies?: SecurityPolicy[] }>("/api/studio/security/policies"),
    upsertPolicy: (body: Record<string, unknown>) =>
      post<{ policies?: SecurityPolicy[] }>("/api/studio/security/policies", body),
    simulate: (body: Record<string, unknown>) => post<Record<string, unknown>>("/api/studio/security/simulate", body),

    jobs: (query?: Query) => request<JobSnapshot>(withQuery("/api/studio/jobs", query)),
    startJob: (body: Record<string, unknown>) => post<{ job?: JobRecord }>("/api/studio/jobs", body),
    job: (id: string) => request<{ job?: JobRecord }>(`/api/studio/jobs/${encodeURIComponent(id)}`),
    cancelJob: (id: string) => post<{ job?: JobRecord }>(`/api/studio/jobs/${encodeURIComponent(id)}/cancel`),
    retryJob: (id: string) => post<{ job?: JobRecord }>(`/api/studio/jobs/${encodeURIComponent(id)}/retry`),
    clearJobs: () => post<Record<string, unknown>>("/api/studio/jobs/clear"),
  },
};

export type Api = typeof api;
export type { StagedCommit, MemoryRecord };
