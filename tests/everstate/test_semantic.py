"""Semantic retrieval with a real embedding model (EmbeddingGemma via Ollama).

Skipped unless Ollama is running with `embeddinggemma` pulled. Proves the system
retrieves by meaning: queries share almost no words with the memories they hit.
"""

from __future__ import annotations

import httpx
import pytest

from everstate import Everstate, MemoryKind, Scope

from .conftest import ACTOR, REDIS_UP, TENANT, make_settings


def _ollama_ready() -> bool:
    try:
        tags = httpx.get("http://localhost:11434/api/tags", timeout=1).json()
        return any(m["name"].startswith("embeddinggemma") for m in tags.get("models", []))
    except Exception:
        return False


pytestmark = [pytest.mark.ollama, pytest.mark.skipif(not _ollama_ready(), reason="Ollama + embeddinggemma not available")]

USER = Scope.parse("user:ada")
FACTS = {
    "diet": "Ada is vegetarian and doesn't eat meat or fish.",
    "commute": "Ada cycles to the office every morning.",
    "language": "Ada writes most of her backend services in Go.",
    "pet": "Ada has a grey cat named Pixel.",
    "timezone": "Ada works from Lisbon, on Western European Time.",
}
PARAPHRASES = {
    "diet": "Should I book a steakhouse for the team dinner with her?",
    "commute": "How does she get to work?",
    "language": "Which programming language should the new microservice use for her team?",
    "pet": "Does she own any animals?",
    "timezone": "What hours is she awake for a call?",
}


@pytest.mark.asyncio
@pytest.mark.parametrize("profile", ["local", pytest.param("redis", marks=pytest.mark.redis)])
async def test_paraphrase_retrieval_top1(profile):
    if profile == "redis" and not REDIS_UP:
        pytest.skip("Redis not available")
    settings = make_settings(profile, embedder="ollama")
    settings.embedding.dimensions = 768
    async with Everstate.from_settings(settings) as es:
        for key, text in FACTS.items():
            await es.remember(TENANT, ACTOR, scope=USER, key=key, content=text, kind=MemoryKind.FACT)
        correct = 0
        for key, question in PARAPHRASES.items():
            r = await es.recall(TENANT, question, scopes=[USER], k=1, use_cache=False)
            correct += bool(r.memories) and r.memories[0].memory.key == key
        assert correct >= 4, f"semantic top-1 {correct}/5"
