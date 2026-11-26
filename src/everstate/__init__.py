"""Everstate — governed long-term memory for AI agents.

Ports-and-adapters core: the engine depends only on `everstate.ports`; storage, vector
search, embeddings, LLMs, caches and event logs are pluggable adapters chosen by
configuration (`everstate.config.Settings`, profiles: local | redis | gcp).
"""

from everstate.config import Settings
from everstate.container import build_runtime
from everstate.domain import Memory, MemoryKind, MemoryStatus, RecallResult, Scope, ScopeLevel
from everstate.engine import Everstate
from everstate.registry import registry

__version__ = "0.1.0"

__all__ = [
    "Everstate", "Memory", "MemoryKind", "MemoryStatus", "RecallResult", "Scope", "ScopeLevel",
    "Settings", "build_runtime", "registry", "__version__",
]
