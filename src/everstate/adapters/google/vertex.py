"""Vertex AI: embeddings + Gemini generation via the google-genai SDK (async client).

Embedding models (Nov 2026 docs):
    gemini-embedding-001   up to 3072-d, 2,048 input tokens, MRL (768/1536 cuts valid)
    gemini-embedding-2     up to 3072-d, 8,192 input tokens, multimodal
    text-embedding-005     up to 768-d, English + code
Task types map document vs. query text to RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY.
Vectors are re-normalised after dimension reduction (required below the native size).
"""

from __future__ import annotations

import asyncio
from typing import Any, Mapping, Sequence

from everstate.domain import AdapterUnavailable, LLMError
from everstate.ports import EmbedTask, Finding, LLMRequest, LLMResponse
from everstate.vectors import normalize

from ._sync import require_project

try:
    from google import genai
    from google.genai import types
except ImportError as exc:  # pragma: no cover
    raise AdapterUnavailable("Vertex adapters need `pip install google-genai`") from exc

_TASK = {EmbedTask.DOCUMENT: "RETRIEVAL_DOCUMENT", EmbedTask.QUERY: "RETRIEVAL_QUERY"}
# Models whose embed endpoint accepts one text per request (per Vertex REST docs).
_SINGLE_INPUT = {"gemini-embedding-001"}


def _client(settings: Any, ctx: Any) -> "genai.Client":
    return ctx.resource(
        "genai",
        lambda: genai.Client(vertexai=True, project=require_project(settings), location=settings.google.location),
    )


class VertexEmbedder:
    def __init__(self, client: "genai.Client", model: str, dimensions: int, batch_size: int, concurrency: int = 8) -> None:
        self.model_id = model
        self.dimensions = dimensions
        self._client = client
        self._batch = 1 if model in _SINGLE_INPUT else max(1, min(batch_size, 250))
        self._sem = asyncio.Semaphore(concurrency)

    async def _embed_batch(self, texts: Sequence[str], task: EmbedTask) -> list[list[float]]:
        async with self._sem:
            resp = await self._client.aio.models.embed_content(
                model=self.model_id,
                contents=list(texts),
                config=types.EmbedContentConfig(task_type=_TASK[task], output_dimensionality=self.dimensions),
            )
        return [normalize(list(e.values or [])) for e in (resp.embeddings or [])]

    async def embed(self, texts: Sequence[str], *, task: EmbedTask = EmbedTask.DOCUMENT) -> list[list[float]]:
        chunks = [texts[i:i + self._batch] for i in range(0, len(texts), self._batch)]
        results = await asyncio.gather(*(self._embed_batch(c, task) for c in chunks))
        return [v for chunk in results for v in chunk]

    async def health(self) -> Mapping[str, Any]:
        return {"ok": True, "backend": "vertex", "model": self.model_id, "dimensions": self.dimensions}


class GeminiLLM:
    def __init__(self, client: "genai.Client", model: str, temperature: float) -> None:
        self.model_id = model
        self._client = client
        self._temperature = temperature

    async def generate(self, request: LLMRequest) -> LLMResponse:
        contents = [
            types.Content(role="model" if m.role == "assistant" else "user", parts=[types.Part.from_text(text=m.content)])
            for m in request.messages if m.role != "system"
        ]
        system = request.system or "\n".join(m.content for m in request.messages if m.role == "system") or None
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=request.temperature if request.temperature is not None else self._temperature,
            max_output_tokens=request.max_output_tokens,
            response_mime_type="application/json" if request.json_schema else None,
            response_json_schema=dict(request.json_schema) if request.json_schema else None,
        )
        model = request.model or self.model_id
        try:
            resp = await self._client.aio.models.generate_content(model=model, contents=contents, config=config)
        except Exception as exc:
            raise LLMError(f"Gemini call failed ({model}): {exc}") from exc
        usage = resp.usage_metadata
        return LLMResponse(
            text=resp.text or "",
            model_id=model,
            usage={
                "input_tokens": int(getattr(usage, "prompt_token_count", 0) or 0),
                "output_tokens": int(getattr(usage, "candidates_token_count", 0) or 0),
            },
            finish_reason=str(resp.candidates[0].finish_reason) if resp.candidates else None,
        )


def build_embedder(settings: Any, ctx: Any) -> VertexEmbedder:
    emb = settings.embedding
    return VertexEmbedder(_client(settings, ctx), emb.model or "gemini-embedding-001", emb.dimensions, emb.batch_size)


def build_llm(settings: Any, ctx: Any) -> GeminiLLM:
    llm = settings.llm_settings
    return GeminiLLM(_client(settings, ctx), llm.model, llm.temperature)


class GeminiSearchResearcher:
    """Gemini grounded with Google Search: answers a question and returns each supported
    claim with the web source that grounds it (grounding_metadata supports -> chunks).

    OPT-IN / FUTURE: grounding with Google Search is billed per grounded request, so no
    profile enables it. Turn it on explicitly with EVERSTATE_RESEARCHER=gemini_search."""

    def __init__(self, client: "genai.Client", model: str) -> None:
        self.model_id = model
        self._client = client

    async def research(self, question: str, *, max_findings: int = 5) -> list[Finding]:
        resp = await self._client.aio.models.generate_content(
            model=self.model_id,
            contents=f"Answer factually and concisely, one claim per sentence: {question}",
            config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())], temperature=0.0),
        )
        cand = (resp.candidates or [None])[0]
        meta = getattr(cand, "grounding_metadata", None)
        chunks = list(getattr(meta, "grounding_chunks", None) or [])
        findings: list[Finding] = []
        for support in getattr(meta, "grounding_supports", None) or []:
            idx = list(getattr(support, "grounding_chunk_indices", None) or [])
            web = getattr(chunks[idx[0]], "web", None) if idx and idx[0] < len(chunks) else None
            text = getattr(getattr(support, "segment", None), "text", "") or ""
            if web is not None and text.strip():
                scores = list(getattr(support, "confidence_scores", None) or [])
                findings.append(Finding(text.strip(), web.uri or "", web.title or "", float(scores[0]) if scores else 0.6))
            if len(findings) >= max_findings:
                break
        return findings


def build_researcher(settings: Any, ctx: Any) -> GeminiSearchResearcher:
    return GeminiSearchResearcher(_client(settings, ctx), settings.llm_settings.model)
