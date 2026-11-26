"""Local semantic embeddings through Ollama — the default "simulator" for Vertex AI.

The default model is EmbeddingGemma (Google's open 308M embedding model, 768-d,
Matryoshka-trained, so 512/256/128 cuts are valid). It uses task prompts, which this
adapter applies for queries vs. documents as recommended by the model card.

    ollama pull embeddinggemma
    EVERSTATE_EMBEDDER=ollama
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

import httpx

from everstate.domain import AdapterUnavailable
from everstate.ports import EmbedTask
from everstate.vectors import normalize, truncate

_PROMPTS = {
    "embeddinggemma": {
        EmbedTask.QUERY: "task: search result | query: {text}",
        EmbedTask.DOCUMENT: "title: none | text: {text}",
    }
}


class OllamaEmbedder:
    def __init__(self, base_url: str, model: str, dimensions: int, batch_size: int, timeout: float) -> None:
        self.model_id = model
        self.dimensions = dimensions
        self._batch = max(1, batch_size)
        self._client = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout)
        family = model.split(":", 1)[0]
        self._prompts = _PROMPTS.get(family)

    def _format(self, text: str, task: EmbedTask) -> str:
        return self._prompts[task].format(text=text) if self._prompts else text

    async def embed(self, texts: Sequence[str], *, task: EmbedTask = EmbedTask.DOCUMENT) -> list[list[float]]:
        out: list[list[float]] = []
        for start in range(0, len(texts), self._batch):
            chunk = [self._format(t, task) for t in texts[start:start + self._batch]]
            try:
                resp = await self._client.post("/api/embed", json={"model": self.model_id, "input": chunk})
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                raise AdapterUnavailable(f"Ollama embed failed ({self.model_id}): {exc}") from exc
            out += [truncate(normalize(v), self.dimensions) for v in resp.json()["embeddings"]]
        return out

    async def health(self) -> Mapping[str, Any]:
        try:
            resp = await self._client.get("/api/tags")
            models = [m["name"] for m in resp.json().get("models", [])]
            return {"ok": any(m.startswith(self.model_id) for m in models), "backend": "ollama", "model": self.model_id}
        except httpx.HTTPError as exc:
            return {"ok": False, "backend": "ollama", "error": str(exc)}

    async def aclose(self) -> None:
        await self._client.aclose()


def build_embedder(settings: Any, ctx: Any) -> OllamaEmbedder:
    emb = settings.embedding
    embedder = OllamaEmbedder(
        base_url=emb.base_url or "http://localhost:11434",
        model=emb.model or "embeddinggemma",
        dimensions=emb.dimensions,
        batch_size=emb.batch_size,
        timeout=emb.timeout_seconds,
    )
    ctx.on_close(embedder.aclose)
    return embedder
