"""Typed settings with deployment profiles.

Pick a profile, then override any single choice:

    EVERSTATE_PROFILE=gcp            # spanner + vertex + bigquery, Redis serving tier
    EVERSTATE_EMBEDDER=vertex        # override one port
    EVERSTATE_REDIS_URL=redis://10.0.0.3:6379/0

Profiles
--------
local  everything in-process; deterministic offline embedder + LLM (tests, laptops)
redis  Redis 8 / Memorystore serves everything: store, vector index, cache, event stream
gcp    Spanner (system of record + ANN), BigQuery (event log), Vertex AI (embeddings,
       Gemini), Memorystore/Redis as the low-latency serving tier and cache
"""

from __future__ import annotations

import os
from typing import Any, Literal, Mapping

from pydantic import BaseModel, Field

from everstate.domain import ConfigurationError

Profile = Literal["local", "redis", "gcp"]
Serving = Literal["direct", "redis"]

PROFILE_DEFAULTS: dict[str, dict[str, str]] = {
    "local": {"store": "memory", "index": "memory", "cache": "memory", "events": "memory",
              "embedder": "hashing", "llm": "offline", "researcher": "none", "serving": "direct"},
    "redis": {"store": "redis", "index": "redis", "cache": "redis", "events": "redis",
              "embedder": "hashing", "llm": "offline", "researcher": "none", "serving": "direct"},
    "gcp":   {"store": "spanner", "index": "spanner", "cache": "redis", "events": "bigquery",
              "embedder": "vertex", "llm": "gemini", "researcher": "none", "serving": "redis"},
}


class EmbeddingSettings(BaseModel):
    # Empty model = provider default: vertex -> gemini-embedding-001, ollama -> embeddinggemma,
    # hashing -> hashing-v1, openai_compatible -> text-embedding-3-small.
    model: str = ""
    dimensions: int = 768               # Gemini embeddings + EmbeddingGemma are MRL-trained: 768 is a valid cut
    batch_size: int = 64
    base_url: str | None = None         # ollama: http://localhost:11434
    timeout_seconds: float = 30.0


class LLMSettings(BaseModel):
    model: str = "gemini-3.8-flash"
    reasoning_model: str = "gemini-4-argon"
    temperature: float = 0.2
    base_url: str | None = None         # openai_compatible: e.g. http://127.0.0.1:18080/v1
    api_key: str | None = None
    timeout_seconds: float = 60.0


class RedisSettings(BaseModel):
    url: str = "redis://localhost:6379/0"
    cluster: bool = False               # Memorystore for Redis Cluster / Valkey cluster mode
    key_prefix: str = "es"
    # auto: Query Engine (FT.*) if present — Redis Stack, Memorystore for Valkey/Redis Cluster —
    # else Redis 8 core Vector Sets (VADD/VSIM).
    vector_backend: Literal["auto", "query_engine", "vectorset"] = "auto"
    vectorset_quant: Literal["NOQUANT", "Q8", "BIN"] = "Q8"
    index_algorithm: Literal["HNSW", "FLAT"] = "HNSW"
    hnsw_m: int = 16
    hnsw_ef_construction: int = 200
    hnsw_ef_runtime: int = 200          # measured: 98.5% top-5 agreement with exact search at 1k
    stream_maxlen: int = 200_000
    socket_timeout_seconds: float = 5.0


class GoogleSettings(BaseModel):
    project: str | None = None
    location: str = "global"            # Gemini / embeddings endpoint location
    region: str = "us-central1"
    spanner_instance: str = "everstate-spanner"
    spanner_database: str = "everstate_memory"
    spanner_table: str = "EverstateMemories"
    spanner_vector_index: str = "EverstateMemoriesByEmbedding"
    spanner_search: Literal["ann", "exact"] = "ann"   # ann requires Enterprise edition
    spanner_num_leaves_to_search: int = 16
    firestore_database: str = "(default)"
    firestore_collection: str = "everstate_memories"
    bigquery_dataset: str = "everstate_telemetry"
    bigquery_events_table: str = "everstate_events"
    vector_search_index: str | None = None            # projects/…/indexes/…
    vector_search_endpoint: str | None = None         # projects/…/indexEndpoints/…
    vector_search_deployed_index_id: str | None = None


class VectorDBSettings(BaseModel):
    """Managed vector databases (used when EVERSTATE_INDEX=qdrant|pinecone)."""

    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_collection: str = "everstate_memories"
    pinecone_host: str | None = None        # index host, e.g. https://everstate-abc123.svc.aped-1234.pinecone.io
    pinecone_api_key: str | None = None
    pinecone_api_version: str = "2025-04"
    timeout_seconds: float = 10.0


class RecallSettings(BaseModel):
    k: int = 8
    candidate_multiplier: int = 4       # fetch k * m candidates before re-scoring/arbitration
    min_similarity: float = 0.1          # cosine floor; embedding models differ in scale, tune per model
    w_similarity: float = 0.75
    w_recency: float = 0.15
    w_confidence: float = 0.10
    w_utility: float = 0.20             # learned from feedback; neutral prior contributes 0
    half_life_days: float = 30.0
    session_ttl_seconds: int = 24 * 3600
    cache_ttl_seconds: int = 60
    embedding_cache_ttl_seconds: int = 7 * 24 * 3600


class Settings(BaseModel):
    profile: Profile = "local"
    store: str = ""
    index: str = ""
    cache: str = ""
    events: str = ""
    embedder: str = ""
    llm: str = ""
    researcher: str = ""
    serving: Serving | Literal[""] = ""
    embedding: EmbeddingSettings = Field(default_factory=EmbeddingSettings)
    llm_settings: LLMSettings = Field(default_factory=LLMSettings)
    redis: RedisSettings = Field(default_factory=RedisSettings)
    google: GoogleSettings = Field(default_factory=GoogleSettings)
    vectordb: VectorDBSettings = Field(default_factory=VectorDBSettings)
    recall: RecallSettings = Field(default_factory=RecallSettings)

    def model_post_init(self, _: Any) -> None:
        defaults = PROFILE_DEFAULTS.get(self.profile)
        if defaults is None:
            raise ConfigurationError(f"unknown profile {self.profile!r}")
        for name, value in defaults.items():
            if not getattr(self, name):
                setattr(self, name, value)
        if self.serving == "redis" and self.store == "redis":
            self.serving = "direct"     # Redis already is the store

    def describe(self) -> dict[str, str]:
        return {p: getattr(self, p) for p in ("profile", "store", "index", "cache", "events", "embedder", "llm", "researcher", "serving")}

    # ------------------------------------------------------------------ env loading
    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env

        def get(name: str, default: Any = None) -> Any:
            return env.get(f"EVERSTATE_{name}", default)

        def section(model: type[BaseModel], prefix: str, aliases: Mapping[str, str] = {}) -> dict[str, Any]:
            out: dict[str, Any] = {}
            for field_name in model.model_fields:
                raw = get(f"{prefix}{field_name.upper()}")
                if raw is None and field_name in aliases:
                    raw = env.get(aliases[field_name])
                if raw is not None and raw != "":
                    out[field_name] = raw
            return out

        return cls(
            profile=get("PROFILE", "local"),
            store=get("STORE", ""),
            index=get("INDEX", ""),
            cache=get("CACHE", ""),
            events=get("EVENTS", ""),
            embedder=get("EMBEDDER", ""),
            llm=get("LLM", ""),
            researcher=get("RESEARCHER", ""),
            serving=get("SERVING", ""),
            embedding=EmbeddingSettings(**section(EmbeddingSettings, "EMBED_")),
            llm_settings=LLMSettings(**section(
                LLMSettings, "LLM_",
                {"model": "EVERSTATE_CHAT_MODEL", "reasoning_model": "EVERSTATE_REASONING_MODEL",
                 "base_url": "OPENAI_BASE_URL", "api_key": "OPENAI_API_KEY"},
            )),
            redis=RedisSettings(**section(RedisSettings, "REDIS_")),
            google=GoogleSettings(**section(
                GoogleSettings, "GOOGLE_",
                {"project": "GOOGLE_CLOUD_PROJECT", "region": "GOOGLE_CLOUD_REGION",
                 "spanner_instance": "SPANNER_INSTANCE", "spanner_database": "SPANNER_DATABASE",
                 "bigquery_dataset": "BIGQUERY_DATASET"},
            )),
            vectordb=VectorDBSettings(**section(
                VectorDBSettings, "",
                {"qdrant_api_key": "QDRANT_API_KEY", "pinecone_api_key": "PINECONE_API_KEY"},
            )),
            recall=RecallSettings(**section(RecallSettings, "RECALL_")),
        )
