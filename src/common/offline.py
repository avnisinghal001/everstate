"""Offline mode: deterministic stand-ins for Gemini so Everstate runs without Google Cloud.

Set ``EVERSTATE_OFFLINE=true`` (the default for local development) to route every LLM call
through these helpers instead of Vertex AI:

* ``resolve_agent_model(name)`` returns an ADK ``BaseLlm`` that extracts facts with
  simple rules, calls the agent's tools exactly like a real model would, then replies.
* ``make_genai_client(**kwargs)`` returns an object with the same
  ``client.models.generate_content(...)`` surface as ``google.genai.Client``.

Offline output is intentionally simple and reproducible. It exists so the console,
the Dream Cycle pipeline and the test suite work end to end on any laptop.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, AsyncGenerator, Dict, List, Optional

_TRUE = ("1", "true", "yes", "on")


def is_offline() -> bool:
    """True when Everstate should never call Vertex AI. Always False on Cloud Run."""
    if os.environ.get("K_SERVICE"):
        return False
    return os.environ.get("EVERSTATE_OFFLINE", "false").strip().lower() in _TRUE


# --------------------------------------------------------------------------- #
# Rule-based fact extraction shared by the agent model and the genai client.
# --------------------------------------------------------------------------- #

_FACT_RULES = [
    ("name", "profile", r"\bmy name is\s+([A-Z][A-Za-z'-]+)"),
    ("name", "profile", r"\b(?:i'm|i am)\s+([A-Z][a-z'-]+)\b(?!\s+(?:a|an|the)\b)"),
    ("favorite_language", "technical", r"favou?rite (?:programming )?language is\s+([A-Za-z+#.]+)"),
    ("job_role", "role", r"(?:my job role is|my role is|i work as(?: an?)?|i am an?|i'm an?)\s+([A-Za-z][A-Za-z \-]{2,60}?)(?:[.,;!\n]|\band\b|$)"),
    ("preferred_tools", "infrastructure", r"(?:i (?:mostly )?use|i prefer (?:using|to use)|my stack is|we deploy (?:on|to))\s+([A-Za-z0-9 ,.+/-]{2,80}?)(?:[.;!\n]|$)"),
    ("work_style", "preference", r"(?:i prefer(?! using| to use)|i like to)\s+([^.;!\n]{3,120})"),
]


_STOPWORDS = {"and", "the", "for", "with", "before", "after", "from", "into", "that", "this", "use", "using"}


def extract_facts(text: str) -> List[Dict[str, Any]]:
    """Pull simple profile facts out of free text. Later mentions win."""
    found: Dict[str, Dict[str, Any]] = {}
    for key, category, pattern in _FACT_RULES:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            value = match.group(1).strip().rstrip(".,")
            if not value or (key == "name" and value.lower() in {"a", "an", "the", "not", "using"}):
                continue
            found[key] = {"topic": key, "answer": value, "category": category}
    for match in re.finditer(r"\b(always|never)\s+([^.;!\n]{4,140})", text, flags=re.IGNORECASE):
        rule = f"{match.group(1).capitalize()} {match.group(2).strip()}"
        slug = re.sub(r"[^a-z0-9]+", "_", match.group(2).lower()).strip("_")[:40] or "rule"
        found[f"guardrail_{slug}"] = {"topic": f"guardrail_{slug}", "answer": rule, "category": "guardrail"}
    return list(found.values())


def _belief(fact: Dict[str, Any]) -> str:
    key, value = fact["topic"], fact["answer"]
    if key == "name":
        return f"The user's name is {value}."
    if key == "favorite_language":
        return f"The user's favorite programming language is {value}."
    if key == "job_role":
        return f"The user works as {value}."
    if key == "preferred_tools":
        return f"The user's preferred tools are {value}."
    if fact["category"] == "guardrail":
        return value if value.endswith(".") else value + "."
    return f"The user prefers to {value}."


def _summary_payload(prompt: str) -> Dict[str, Any]:
    user_match = re.search(r'"user_id":\s*"([^"]+)"', prompt) or re.search(r"user_id=([\w:.-]+)", prompt)
    session_match = re.search(r'"session_id":\s*"([^"]+)"', prompt) or re.search(r"session_id=([\w:.-]+)", prompt)
    user_lines = "\n".join(
        line.split(":", 1)[1] for line in prompt.splitlines() if line.strip().upper().startswith(("USER_PROMPT:", "USER:"))
    ) or prompt
    facts = extract_facts(user_lines)
    prefs = [
        {
            "preference_key": f["topic"],
            "preference_value": f["answer"],
            "category": f["category"],
            "confidence": 0.9 if f["category"] != "guardrail" else 0.85,
            "crystallized_belief": _belief(f),
            "keywords": ", ".join(sorted(set(re.findall(r"[a-z]{3,}", (f["topic"] + " " + f["answer"]).lower())) - _STOPWORDS)),
        }
        for f in facts
    ]
    summary = (
        f"Offline Dream Cycle consolidated {len(prefs)} memory candidate(s) from the session."
        if prefs else "Offline Dream Cycle found no durable preferences in this session."
    )
    return {
        "user_id": user_match.group(1) if user_match else "user:developer",
        "session_id": session_match.group(1) if session_match else "offline-session",
        "summary": summary,
        "session_intent": "Share profile details and working preferences.",
        "cross_session_intent": "Share profile details and working preferences.",
        "intent_trajectory": "Consolidated offline from recorded activity.",
        "intent_category": "profile_building",
        "intent_confidence": 0.8,
        "preferences": prefs,
    }


# --------------------------------------------------------------------------- #
# google.genai.Client stand-in
# --------------------------------------------------------------------------- #

class _OfflineResponse:
    def __init__(self, text: str):
        self.text = text
        self.candidates: List[Any] = []
        self.usage_metadata = None


class _OfflineModels:
    def generate_content(self, model: str = "", contents: Any = None, config: Any = None, **_: Any) -> _OfflineResponse:
        prompt = contents if isinstance(contents, str) else json.dumps(contents, default=str)
        wants_json = getattr(config, "response_mime_type", None) == "application/json" or (
            isinstance(config, dict) and config.get("response_mime_type") == "application/json"
        )
        if wants_json:
            return _OfflineResponse(json.dumps(_summary_payload(prompt)))
        facts = extract_facts(prompt)
        if facts:
            lines = "\n".join(f"- **{f['topic'].replace('_', ' ')}**: {f['answer']}" for f in facts)
            return _OfflineResponse(f"Here is what I can tell from memory:\n{lines}")
        return _OfflineResponse("Offline mode: no live model is connected, so this is a deterministic placeholder reply.")

    async def generate_content_async(self, *args: Any, **kwargs: Any) -> _OfflineResponse:
        return self.generate_content(*args, **kwargs)


class OfflineGenaiClient:
    """Minimal subset of ``google.genai.Client`` used by Everstate."""

    def __init__(self, *_: Any, **__: Any):
        self.models = _OfflineModels()
        self.aio = self


def make_genai_client(**kwargs: Any) -> Any:
    """Return a real ``google.genai.Client`` online, or the offline stand-in."""
    if is_offline():
        return OfflineGenaiClient(**kwargs)
    from google import genai

    return genai.Client(**kwargs)


# --------------------------------------------------------------------------- #
# ADK model stand-in
# --------------------------------------------------------------------------- #

def resolve_agent_model(model_name: str) -> Any:
    """Model value for an ADK ``Agent``: the configured name online, ``OfflineLlm`` offline."""
    if not is_offline():
        return model_name
    return OfflineLlm(model=f"offline/{model_name}")


try:  # ADK is a hard dependency, but keep this module importable on its own.
    from google.adk.models.base_llm import BaseLlm
    from google.adk.models.llm_request import LlmRequest
    from google.adk.models.llm_response import LlmResponse
    from google.genai import types

    class OfflineLlm(BaseLlm):
        """Deterministic ADK model: records extracted facts via tools, then replies."""

        @classmethod
        def supported_models(cls) -> list[str]:
            return [r"offline/.*"]

        async def generate_content_async(
            self, llm_request: LlmRequest, stream: bool = False
        ) -> AsyncGenerator[LlmResponse, None]:
            contents = llm_request.contents or []
            last = contents[-1] if contents else None
            tools = set((llm_request.tools_dict or {}).keys())

            tool_results = [
                p.function_response for p in (last.parts or []) if getattr(p, "function_response", None)
            ] if last else []
            user_text = ""
            for content in reversed(contents):
                if content.role == "user":
                    user_text = " ".join(p.text for p in (content.parts or []) if getattr(p, "text", None))
                    if user_text:
                        break

            if tool_results:
                yield LlmResponse(content=types.Content(role="model", parts=[types.Part.from_text(text=self._after_tools(tool_results))]))
                return

            facts = extract_facts(user_text)
            if "record_user_answer" in tools and facts:
                calls = [
                    types.Part(function_call=types.FunctionCall(name="record_user_answer", args={"user_id": "user", "topic": f["topic"], "answer": f["answer"], "category": f["category"]}))
                    for f in facts
                ]
                yield LlmResponse(content=types.Content(role="model", parts=calls))
                return
            if "lookup_preference_in_spanner" in tools:
                reply = (
                    "I don't have that in long-term memory yet. Share it in the Interview tab, "
                    "then run a Dream Cycle to consolidate it."
                )
                yield LlmResponse(content=types.Content(role="model", parts=[types.Part.from_text(text=reply)]))
                return

            reply = (
                "Thanks! Tell me a little about yourself: your name, your role, your favorite language, "
                "and how you like to work. I'll remember it."
            )
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part.from_text(text=reply)]))

        @staticmethod
        def _after_tools(results: List[Any]) -> str:
            recorded = [r for r in results if r.name == "record_user_answer"]
            if recorded:
                items = []
                for r in recorded:
                    resp = r.response or {}
                    topic = str(resp.get("topic") or resp.get("recorded", {}).get("topic", "") or "detail")
                    answer = str(resp.get("answer") or resp.get("recorded", {}).get("answer", ""))
                    label = "rule" if topic.startswith("guardrail_") else topic.replace("_", " ")
                    items.append(f"**{label}**{': ' + answer if answer else ''}")
                return (
                    "Got it. I recorded " + ", ".join(items) + ". "
                    "These will be consolidated into long-term memory during the next Dream Cycle. "
                    "What tools do you reach for most often?"
                )
            payload = json.dumps(results[0].response, default=str) if results else "{}"
            if '"preferences": []' in payload or payload in ("{}", "null"):
                return "I don't have that in long-term memory yet. Share it in the Interview tab and run a Dream Cycle."
            return "From long-term memory: " + payload[:600]

except ImportError:  # pragma: no cover
    OfflineLlm = None  # type: ignore[assignment,misc]
