-- Everstate memory table for Cloud Spanner (generated from everstate.adapters.google.spanner.ddl).
-- The VECTOR INDEX needs Spanner Enterprise (or Enterprise Plus); with EVERSTATE_GOOGLE_SPANNER_SEARCH=exact
-- skip it and COSINE_DISTANCE KNN works on any edition. Dimension must match EVERSTATE_EMBED_DIMENSIONS.

CREATE TABLE EverstateMemories (
  TenantId STRING(128) NOT NULL,
  MemoryId STRING(64) NOT NULL,
  ScopeKey STRING(320) NOT NULL,
  ScopeLevel STRING(16) NOT NULL,
  Kind STRING(16) NOT NULL,
  MemKey STRING(256) NOT NULL,
  Content STRING(MAX) NOT NULL,
  Confidence FLOAT64 NOT NULL,
  Status STRING(16) NOT NULL,
  Embedding ARRAY<FLOAT32>(vector_length=>768),
  EmbeddingModel STRING(128),
  Doc JSON NOT NULL,
  CreatedAt TIMESTAMP NOT NULL,
  UpdatedAt TIMESTAMP NOT NULL,
  ExpiresAt TIMESTAMP,
  Supersedes STRING(64),
  Version INT64 NOT NULL,
) PRIMARY KEY (TenantId, MemoryId),
  ROW DELETION POLICY (OLDER_THAN(ExpiresAt, INTERVAL 0 DAY));

CREATE INDEX EverstateMemoriesByKey ON EverstateMemories(TenantId, MemKey);

CREATE INDEX EverstateMemoriesByUpdated ON EverstateMemories(TenantId, UpdatedAt DESC);

CREATE VECTOR INDEX EverstateMemoriesByEmbedding ON EverstateMemories(Embedding)
  STORING (ScopeKey, Kind, Status, ExpiresAt)
  WHERE Embedding IS NOT NULL
  OPTIONS (distance_type = 'COSINE');
