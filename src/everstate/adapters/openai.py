"""Any OpenAI-compatible endpoint (OpenAI, vLLM, LiteLLM, the local Codex-backed server…).

Plain httpx, no SDK. Configure with EVERSTATE_LLM_BASE_URL / OPENAI_BASE_URL and
EVERSTATE_LLM_MODEL. Note: the local Codex-backed server has no embeddings endpoint.
"""

from __future__ import annotations

from typing import Any, Sequence

import httpx

from everstate.domain import ConfigurationError, LLMError
from everstate.ports import EmbedTask, LLMRequest, LLMResponse
from everstate.vectors import normalize, truncate


def _client(base_url: str | None, api_key: str | None, timeout: float) -> httpx.AsyncClient:
    if not base_url:
        raise ConfigurationError("set EVERSTATE_LLM_BASE_URL or OPENAI_BASE_URL for openai_compatible adapters")
    headers = {"Authorization": f"Bearer {api_key or 'not-needed'}"}
    return httpx.AsyncClient(base_url=base_url.rstrip("/"), headers=headers, timeout=timeout)


class OpenAICompatibleLLM:
    def __init__(self, client: httpx.AsyncClient, model: str, temperature: float) -> None:
        self.model_id = model
        self._http, self._temperature = client, temperature

    async def generate(self, request: LLMRequest) -> LLMResponse:
        messages = ([{"role": "system", "content": request.system}] if request.system else []) + [
            {"role": m.role, "content": m.content} for m in request.messages
        ]
        body: dict[str, Any] = {
            "model": request.model or self.model_id,
            "messages": messages,
            "temperature": request.temperature,
            "max_tokens": request.max_output_tokens,
        }
        if request.json_schema:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "everstate_output", "schema": dict(request.json_schema)},
            }
        try:
            resp = await self._http.post("/chat/completions", json=body)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMError(f"OpenAI-compatible call failed ({body['model']}): {exc}") from exc
        data = resp.json()
        choice = data["choices"][0]
        usage = data.get("usage") or {}
        return LLMResponse(
            text=choice["message"].get("content") or "",
            model_id=data.get("model", body["model"]),
            usage={"input_tokens": int(usage.get("prompt_tokens", 0)), "output_tokens": int(usage.get("completion_tokens", 0))},
            finish_reason=choice.get("finish_reason"),
        )


class OpenAICompatibleEmbedder:
    def __init__(self, client: httpx.AsyncClient, model: str, dimensions: int, batch_size: int) -> None:
        self.model_id, self.dimensions = model, dimensions
        self._http, self._batch = client, max(1, batch_size)

    async def embed(self, texts: Sequence[str], *, task: EmbedTask = EmbedTask.DOCUMENT) -> list[list[float]]:
        out: list[list[float]] = []
        for start in range(0, len(texts), self._batch):
            resp = await self._http.post("/embeddings", json={"model": self.model_id, "input": list(texts[start:start + self._batch]),
                                                              "dimensions": self.dimensions})
            resp.raise_for_status()
            out += [truncate(normalize(d["embedding"]), self.dimensions) for d in resp.json()["data"]]
        return out


def build_llm(settings: Any, ctx: Any) -> OpenAICompatibleLLM:
    llm = settings.llm_settings
    client = _client(llm.base_url, llm.api_key, llm.timeout_seconds)
    ctx.on_close(client.aclose)
    model = llm.model if not llm.model.startswith("gemini") else "gpt-6-luna"
    return OpenAICompatibleLLM(client, model, llm.temperature)


def build_embedder(settings: Any, ctx: Any) -> OpenAICompatibleEmbedder:
    emb, llm = settings.embedding, settings.llm_settings
    client = _client(emb.base_url or llm.base_url, llm.api_key, emb.timeout_seconds)
    ctx.on_close(client.aclose)
    return OpenAICompatibleEmbedder(client, emb.model or "text-embedding-3-small", emb.dimensions, emb.batch_size)
