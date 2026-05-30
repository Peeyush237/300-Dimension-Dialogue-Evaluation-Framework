from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

import httpx

VALIDATION_SYSTEM_PROMPT = """You are a strict conversation input validator.
Decide whether the provided text is a genuine multi-turn dialogue suitable for conversation quality evaluation.

Valid examples:
- User and assistant chat transcripts
- Customer support conversations
- Interview-style exchanges
- Role-play dialogues with clear speakers

Invalid examples:
- JSON configs, API schemas, or metadata dumps
- Source code, stack traces, or log files without dialogue
- Product descriptions, articles, or essays with no dialogue structure
- Facet score lists or evaluation outputs
- Random text, lorem ipsum, or single isolated sentences with no dialogue context

When uncertain, mark invalid. Do not invent dialogue that is not present.

Return ONLY valid JSON:
{"valid": true|false, "reason": "<short explanation>"}
"""

VALIDATION_USER_PROMPT = """TEXT TO VALIDATE:
{conversation_text}
"""


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    reason: str
    source: str


class ConversationValidationError(ValueError):
    pass


class ConversationValidator:
    def __init__(self, model_name: str | None = None, timeout_seconds: int = 30) -> None:
        self._load_env_file()
        self.model_name = model_name or os.getenv("MODEL_NAME", "llama-3.1-8b-instant")
        self.timeout_seconds = timeout_seconds
        self.api_key = os.getenv("GROQ_API_KEY", "")
        self.use_llm_gate = os.getenv("CONVERSATION_LLM_GATE", "true").lower() != "false"
        self.base_url = "https://api.groq.com/openai/v1"

    @staticmethod
    def _load_env_file() -> None:
        env_path = Path(__file__).resolve().parents[1] / ".env"
        if not env_path.exists():
            return
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

    def validate_heuristics(self, turns: List[Dict[str, str]]) -> ValidationResult:
        if not turns:
            return ValidationResult(False, "No conversation turns found.", "heuristic")

        if len(turns) > 500:
            return ValidationResult(False, "Conversation exceeds 500 turns.", "heuristic")

        contents = [turn["content"].strip() for turn in turns]
        roles = [turn["role"] for turn in turns]

        if any(len(content) > 50000 for content in contents):
            return ValidationResult(False, "A turn exceeds the maximum allowed length.", "heuristic")

        if all(len(content) < 3 for content in contents):
            return ValidationResult(False, "Turn content is too short to be a conversation.", "heuristic")

        if _looks_like_facet_scores(turns):
            return ValidationResult(
                False,
                "Input looks like facet evaluation output, not a conversation.",
                "heuristic",
            )

        if _looks_like_config_blob(contents):
            return ValidationResult(
                False,
                "Input looks like structured configuration or metadata, not dialogue.",
                "heuristic",
            )

        user_turns = sum(1 for role in roles if role == "user")
        assistant_turns = sum(1 for role in roles if role == "assistant")
        system_turns = sum(1 for role in roles if role == "system")

        if user_turns == 0 and assistant_turns == 0:
            return ValidationResult(
                False,
                "No user or assistant turns found. A conversation needs dialogue participants.",
                "heuristic",
            )

        if system_turns == len(turns):
            return ValidationResult(
                False,
                "All turns are system messages. Provide user/assistant dialogue.",
                "heuristic",
            )

        if user_turns + assistant_turns < 1:
            return ValidationResult(
                False,
                "Conversation must include at least one user or assistant turn.",
                "heuristic",
            )

        if len(turns) == 1 and len(contents[0]) < 20:
            return ValidationResult(
                False,
                "Single-turn input is too short to evaluate as a conversation.",
                "heuristic",
            )

        code_like = sum(1 for content in contents if _looks_like_code_or_logs(content))
        if code_like / len(contents) >= 0.6:
            return ValidationResult(
                False,
                "Input appears to be code or logs rather than a conversation.",
                "heuristic",
            )

        return ValidationResult(True, "Heuristic checks passed.", "heuristic")

    async def validate(self, turns: List[Dict[str, str]], conversation_text: str) -> ValidationResult:
        heuristic = self.validate_heuristics(turns)
        if not heuristic.valid:
            return heuristic

        if not self.use_llm_gate:
            return ValidationResult(True, "Accepted by heuristic validation.", "heuristic")

        if not self.api_key:
            return ValidationResult(True, "Accepted by heuristic validation.", "heuristic")

        return await self._validate_with_llm(conversation_text)

    async def _validate_with_llm(self, conversation_text: str) -> ValidationResult:
        payload = {
            "model": self.model_name,
            "temperature": 0.0,
            "messages": [
                {"role": "system", "content": VALIDATION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": VALIDATION_USER_PROMPT.format(conversation_text=conversation_text),
                },
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        timeout = httpx.Timeout(self.timeout_seconds)
        async with httpx.AsyncClient(base_url=self.base_url, timeout=timeout) as client:
            response = await client.post("/chat/completions", headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = _parse_json(content)
            valid = bool(parsed.get("valid"))
            reason = str(parsed.get("reason") or "LLM rejected the input.")
            return ValidationResult(valid, reason, "llm")

    def ensure_valid(self, result: ValidationResult) -> None:
        if not result.valid:
            raise ConversationValidationError(result.reason)


def _looks_like_facet_scores(turns: List[Dict[str, str]]) -> bool:
    facet_hits = 0
    for turn in turns:
        content = turn["content"]
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and "scores" in payload:
            facet_hits += 1
        if isinstance(payload, list) and payload and isinstance(payload[0], dict):
            keys = set(payload[0].keys())
            if {"facet_name", "score"}.issubset(keys):
                facet_hits += 1
    return facet_hits > 0


def _looks_like_config_blob(contents: List[str]) -> bool:
    config_markers = 0
    for content in contents:
        stripped = content.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                payload = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                keys = {str(key).lower() for key in payload.keys()}
                if keys & {"api_key", "config", "settings", "schema", "version", "metadata", "facets"}:
                    config_markers += 1
                if "turns" not in keys and "messages" not in keys and "conversation" not in keys:
                    if len(keys) >= 4:
                        config_markers += 1
    return config_markers >= max(1, len(contents) // 2)


def _looks_like_code_or_logs(content: str) -> bool:
    markers = (
        r"^\s*(def |class |import |from |const |let |var |function |#include|public class)",
        r"Traceback \(most recent call last\)",
        r"^\s*at .+\(.+:\d+:\d+\)",
        r"Error:\s",
        r"^\s*\{[\s\S]*\"[a-z_]+\":",
    )
    return any(re.search(pattern, content, re.MULTILINE | re.IGNORECASE) for pattern in markers)


def _parse_json(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("LLM validation response was not valid JSON.") from exc
