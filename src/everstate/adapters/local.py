"""Deterministic local adapters: no network, no model weights.

HashingEmbedder
    Signed feature hashing of word unigrams, bigrams and character trigrams with
    BLAKE2b, then L2-normalised. It is stable across processes and machines (unlike
    Python's salted ``hash()``), so stored vectors stay valid. It captures lexical
    overlap, not meaning: use it for tests and CI, and a semantic model (EmbeddingGemma
    via Ollama, Vertex AI) for anything that should understand paraphrases.

OfflineLLM
    A rule-based stand-in that returns schema-shaped JSON for consolidation and a short
    extractive answer otherwise, so pipelines run end-to-end without an API.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
from typing import Any, Sequence

from everstate.ports import EmbedTask, Finding, LLMRequest, LLMResponse
from everstate.vectors import normalize

_TOKEN = re.compile(r"[a-z0-9][a-z0-9+#._-]*")
_STOP = frozenset(
    "a an and are as at be by for from has have i in is it its me my of on or our so that the "
    "this to was we what when where which who will with you your".split()
)


class HashingEmbedder:
    def __init__(self, dimensions: int = 768, model_id: str = "hashing-v1") -> None:
        self.dimensions = dimensions
        self.model_id = model_id

    def _features(self, text: str) -> list[tuple[str, float]]:
        words = [w for w in _TOKEN.findall(text.lower()) if w not in _STOP]
        feats: list[tuple[str, float]] = [(f"w:{w}", 1.0) for w in words]
        feats += [(f"b:{a}_{b}", 0.6) for a, b in zip(words, words[1:])]
        for w in words:
            padded = f"^{w}$"
            feats += [(f"c:{padded[i:i + 3]}", 0.25) for i in range(len(padded) - 2)]
        return feats

    def embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self.dimensions
        for feat, weight in self._features(text):
            digest = hashlib.blake2b(feat.encode(), digest_size=8).digest()
            bucket, sign_bits = struct.unpack("<IL", digest)
            vec[bucket % self.dimensions] += weight if sign_bits & 1 else -weight
        return normalize(vec)

    async def embed(self, texts: Sequence[str], *, task: EmbedTask = EmbedTask.DOCUMENT) -> list[list[float]]:
        return [self.embed_one(t) for t in texts]


_FACT_PATTERNS: list[tuple[str, str, str, str]] = [
    ("name", "fact", r"\bmy name is\s+([A-Z][\w'-]+)", "The user's name is {v}."),
    ("job_role", "fact", r"\b(?:i work as(?: an?)?|my (?:job )?role is)\s+([^.,;\n]{3,60})", "The user works as {v}."),
    ("favorite_language", "preference", r"favou?rite (?:programming )?language is\s+([\w+#.]+)",
     "The user's favorite programming language is {v}."),
    ("preferred_tools", "preference", r"\bi (?:prefer|like) (?:using|to use)\s+([^.;\n]{2,80})", "The user prefers using {v}."),
    ("timezone", "fact", r"\b(?:i'?m in|my timezone is)\s+([A-Z]{2,5}|UTC[+-]?\d*)\b", "The user's timezone is {v}."),
]


def extract_candidates(text: str) -> list[dict[str, Any]]:
    """Rule-based memory extraction used by the offline LLM."""
    found: dict[str, dict[str, Any]] = {}
    for key, kind, pattern, template in _FACT_PATTERNS:
        for m in re.finditer(pattern, text, flags=re.IGNORECASE):
            value = m.group(1).strip().rstrip(".")
            found[key] = {"key": key, "kind": kind, "content": template.format(v=value),
                          "confidence": 0.85, "evidence": m.group(0)}
    for m in re.finditer(r"\b(always|never)\s+([^.;!\n]{4,140})", text, flags=re.IGNORECASE):
        rule = f"{m.group(1).capitalize()} {m.group(2).strip()}"
        slug = re.sub(r"[^a-z0-9]+", "_", m.group(2).lower()).strip("_")[:48] or "rule"
        found[f"rule_{slug}"] = {"key": f"rule_{slug}", "kind": "guardrail", "content": rule,
                                 "confidence": 0.8, "evidence": m.group(0)}
    return list(found.values())


class OfflineLLM:
    model_id = "offline-rules-v1"

    async def generate(self, request: LLMRequest) -> LLMResponse:
        text = "\n".join(m.content for m in request.messages if m.role == "user")
        if request.json_schema is not None:
            payload = {"memories": extract_candidates(text)}
            return LLMResponse(text=json.dumps(payload), model_id=self.model_id, finish_reason="stop")
        lines = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("- ")]
        answer = "\n".join(lines[:5]) or "No live model is connected (offline mode)."
        return LLMResponse(text=answer, model_id=self.model_id, finish_reason="stop")


class NoResearcher:
    """Research disabled (default for local/redis profiles): always returns no findings."""

    model_id = "none"

    async def research(self, question: str, *, max_findings: int = 5) -> list[Finding]:
        return []


def build_no_researcher(settings: Any, ctx: Any) -> NoResearcher:
    return NoResearcher()


def build_hashing_embedder(settings: Any, ctx: Any) -> HashingEmbedder:
    return HashingEmbedder(settings.embedding.dimensions, settings.embedding.model or "hashing-v1")


def build_offline_llm(settings: Any, ctx: Any) -> OfflineLLM:
    return OfflineLLM()
