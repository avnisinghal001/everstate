"""The wired set of adapters one engine runs on (built by everstate.container)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping

from everstate.config import Settings
from everstate.ports import LLM, Cache, Embedder, EventLog, MemoryStore, Researcher, VectorIndex
from everstate.registry import BuildContext


@dataclass
class Runtime:
    settings: Settings
    embedder: Embedder
    llm: LLM
    store: MemoryStore
    index: VectorIndex
    cache: Cache
    events: EventLog
    researcher: Researcher
    ctx: BuildContext

    # ------------------------------------------------------------ cache generations
    # Writes bump a per-tenant generation counter; recall cache keys embed it, so every
    # cached recall for a tenant is invalidated in O(1) without scanning keys.
    async def generation(self, tenant_id: str) -> int:
        raw = await self.cache.get(f"gen:{tenant_id}")
        return int(raw) if raw else 0

    async def bump_generation(self, tenant_id: str) -> None:
        await self.cache.incr(f"gen:{tenant_id}")

    async def health(self) -> Mapping[str, Any]:
        out: dict[str, Any] = {"config": self.settings.describe()}
        for name in ("embedder", "llm", "store", "index", "cache", "events", "researcher"):
            component = getattr(self, name)
            probe = getattr(component, "health", None)
            try:
                out[name] = dict(await probe()) if probe else {"ok": True, "type": type(component).__name__}
            except Exception as exc:  # pragma: no cover - surfaced to operators
                out[name] = {"ok": False, "error": str(exc)}
        out["ok"] = all(v.get("ok", True) for k, v in out.items() if isinstance(v, dict) and k != "config")
        return out

    async def aclose(self) -> None:
        await self.ctx.aclose()


def dumps(data: Any) -> bytes:
    return json.dumps(data, separators=(",", ":"), default=str).encode()
