/* Shared API types. The backend payloads are intentionally permissive:
   every record may carry extra fields, so each interface ends with an index
   signature instead of pretending the schema is narrower than it is. */

export type ScopeType = "ORG" | "TEAM" | "AGENT" | "USER";

export interface AuthConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  isLocalDev?: boolean;
  allowedEmailDomains?: string[] | string;
}

export interface ScopeIds {
  org_id: string;
  team_id: string;
  agent_id: string;
  user_id: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string;
  at: number;
}

export interface AntigravitySession {
  session_id: string;
  turns_count?: number;
  turn_count?: number;
  turns?: unknown[];
  title?: string;
  [key: string]: unknown;
}

export interface LakehouseSession {
  session_id: string;
  source?: string;
  summary?: string;
  event_count?: number;
  [key: string]: unknown;
}

export interface LogRecord {
  event_type?: string;
  intent?: string;
  message?: string;
  content?: string;
  turn_index?: number;
  timestamp?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface MemoryRecord {
  memory_key?: string;
  preference_key?: string;
  memory_value?: string;
  preference_value?: string;
  crystallized_belief?: string;
  natural_language_belief?: string;
  memory_type?: string;
  category?: string;
  confidence?: number;
  scope_type?: ScopeType;
  scope_id?: string;
  commit_status?: string;
  staged_id?: string | null;
  before_value?: string | null;
  source_session_id?: string;
  support_count?: number;
  trigger_count?: number;
  useful_count?: number;
  file_path?: string;
  title?: string;
  content?: string;
  [key: string]: unknown;
}

export interface TreePayload {
  status?: string;
  files?: MemoryRecord[];
  tree?: Partial<Record<ScopeType, MemoryRecord[]>>;
  scopes?: Record<string, MemoryRecord[]>;
  staged_commits?: StagedCommit[];
  stats?: Record<string, number>;
  [key: string]: unknown;
}

export interface StagedCommit {
  commit_id?: string;
  staged_id?: string;
  id?: string;
  memory_key?: string;
  file_path?: string;
  scope_type?: ScopeType;
  scope_id?: string;
  category?: string;
  before_value?: string | null;
  after_value?: string | null;
  proposed_content?: string | null;
  commit_status?: string;
  source_session_id?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface StudioSession {
  session_id: string;
  title?: string;
  summary?: string;
  topic?: string;
  stream_source?: string;
  turn_count?: number;
  turns?: Array<Record<string, unknown>>;
  helpfulness?: string;
  created_at?: string;
  updated_at?: string;
  memories_injected?: unknown[];
  memories_extracted?: unknown[];
  [key: string]: unknown;
}

export interface StudioEntity {
  id?: string;
  entity_id?: string;
  scope_id?: string;
  scope_type?: ScopeType;
  display_name?: string;
  name?: string;
  handle?: string;
  owner?: string;
  parent_id?: string;
  description?: string;
  tags?: string[];
  memory_count?: number;
  [key: string]: unknown;
}

export interface StudioCategory {
  id?: string;
  category_id?: string;
  slug?: string;
  label?: string;
  name?: string;
  folder_path?: string;
  description?: string;
  color?: string;
  memory_count?: number;
  total_triggers?: number;
  minConfidence?: number;
  default_threshold?: number;
  cosine_threshold?: number;
  retentionTtl?: string;
  retention_ttl?: string;
  conflictPolicy?: string;
  conflict_policy?: string;
  match_mode?: string;
  default_match_mode?: string;
  default_scope?: ScopeType;
  default_memory_type?: string;
  auto_extract?: boolean;
  [key: string]: unknown;
}

export interface EvalCase {
  case_id?: string;
  id?: string;
  prompt?: string;
  expected_fact?: string;
  category?: string;
  failure_tag?: string;
  source?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface Scorecard {
  pareto_fitness?: number;
  quality_score?: number;
  token_efficiency_score?: number;
  alpha_quality_weight?: number;
  scorecard?: {
    pareto_fitness?: number;
    quality_score?: number;
    token_efficiency_score?: number;
    metrics?: Record<string, number>;
  };
  metrics_breakdown?: Record<string, number>;
  matryoshka_comparison?: Record<string, Record<string, number>>;
  slice_comparison?: { slices?: Array<Record<string, unknown>> };
  [key: string]: unknown;
}

export interface EvolveResult {
  champion?: { config?: Record<string, unknown>; pareto_fitness?: number; [key: string]: unknown };
  active_config?: Record<string, unknown>;
  archive?: { cells?: Record<string, unknown> };
  archive_summary?: { cells?: Array<Record<string, unknown>>; populated_cells?: number };
  [key: string]: unknown;
}

export interface JobRecord {
  job_id: string;
  job_type?: string;
  title?: string;
  status?: string;
  progress?: number;
  current_step?: string;
  triggered_from?: string;
  created_at?: string;
  updated_at?: string;
  duration_ms?: number;
  result_summary?: string;
  error?: string;
  steps?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface IngestConfig {
  source_stream?: string;
  source_type?: string;
  bq_dataset_table?: string;
  lookback_hours?: number;
  min_turn_tokens?: number;
  pii_scrubbing?: boolean;
  auto_extract_signals?: boolean;
  chunk_window_turns?: number;
  signal_detectors?: string[];
  min_confidence_gate?: number;
  dedup_cosine_threshold?: number;
  auto_stage_extracted?: boolean;
  [key: string]: unknown;
}

export interface IngestService {
  service_id?: string;
  id?: string;
  name?: string;
  connector_type?: string;
  endpoint_uri?: string;
  status?: string;
  pii_redaction_mode?: string;
  write_mode?: string;
  chunk_window_turns?: number;
  [key: string]: unknown;
}

export interface Extractor {
  extractor_id?: string;
  id?: string;
  name?: string;
  target_category?: string;
  target_scope?: string;
  model?: string;
  trigger_event?: string;
  confidence_gate?: number;
  write_mode?: string;
  status?: string;
  system_prompt?: string;
  human_params?: Record<string, unknown>;
  few_shot_examples?: string[];
  [key: string]: unknown;
}

export interface SecurityPolicy {
  policy_id?: string;
  id?: string;
  role_name?: string;
  role?: string;
  principal?: string;
  target_scope_id?: string;
  applies_to_descendants?: boolean;
  allowed_scopes?: string[];
  allowed_actions?: string[];
  path_prefix?: string;
  effect?: string;
  max_classification?: string;
  pii_redaction_level?: string;
  [key: string]: unknown;
}

export interface BackendStatus {
  status?: string;
  read_mode?: string;
  write_mode?: string;
  target?: string;
  tables?: Array<Record<string, unknown>>;
  mutations?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface StudioState {
  files?: MemoryRecord[];
  tree?: Partial<Record<ScopeType, MemoryRecord[]>>;
  staged_commits?: StagedCommit[];
  sessions?: StudioSession[];
  entities?: StudioEntity[];
  categories?: StudioCategory[];
  ingest_services?: IngestService[];
  live_events?: Array<Record<string, unknown>>;
  ingest_config?: IngestConfig;
  extractors?: Extractor[];
  backend?: BackendStatus;
  security_policies?: SecurityPolicy[];
  active_config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface JobSnapshot {
  jobs?: JobRecord[];
  counts?: Record<string, number>;
  active?: JobRecord[];
  [key: string]: unknown;
}

export interface PreferenceRecord {
  preference_key?: string;
  memory_key?: string;
  preference_value?: string;
  memory_value?: string;
  crystallized_belief?: string;
  category?: string;
  confidence?: number;
  memory_type?: string;
  updated_at?: string;
  [key: string]: unknown;
}
