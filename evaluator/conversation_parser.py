from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

VALID_ROLES = {"user", "assistant", "system"}

ROLE_ALIASES = {
    "user": "user",
    "human": "user",
    "client": "user",
    "customer": "user",
    "participant": "user",
    "speaker": "user",
    "person": "user",
    "assistant": "assistant",
    "ai": "assistant",
    "bot": "assistant",
    "agent": "assistant",
    "model": "assistant",
    "gpt": "assistant",
    "chatbot": "assistant",
    "advisor": "assistant",
    "system": "system",
}

CONTENT_KEYS = (
    "content",
    "message",
    "text",
    "body",
    "utterance",
    "value",
    "input",
    "output",
    "reply",
    "response",
    "prompt",
    "answer",
)

ROLE_KEYS = ("role", "speaker", "author", "from", "sender", "type", "name")

TURN_CONTAINER_KEYS = (
    "turns",
    "messages",
    "conversation",
    "history",
    "dialogue",
    "chat",
    "utterances",
    "exchanges",
    "transcript",
)

ID_KEYS = ("conversation_id", "id", "session_id", "chat_id", "thread_id")


@dataclass(frozen=True)
class ParsedConversation:
    turns: List[Dict[str, str]]
    conversation_id: Optional[str]
    format_detected: str


class ConversationParseError(ValueError):
    pass


def parse_conversation_input(raw: str) -> ParsedConversation:
    text = raw.strip()
    if not text:
        raise ConversationParseError("Input is empty.")

    if text.startswith("{") or text.startswith("["):
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ConversationParseError(f"Invalid JSON: {exc.msg}") from exc
        return _parse_json_payload(payload)

    return _parse_text_format(text)


def _parse_text_format(text: str) -> ParsedConversation:
    turns: List[Dict[str, str]] = []
    lines = text.split("\n")
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        delimiter_index = stripped.find(":")
        if delimiter_index == -1:
            raise ConversationParseError(
                'Text format requires "role: content" on each non-empty line.'
            )
        role_raw = stripped[:delimiter_index].strip()
        content = stripped[delimiter_index + 1 :].strip()
        role = _normalize_role(role_raw)
        if role is None:
            raise ConversationParseError(
                f'Unknown role "{role_raw}". Use user, assistant, or system (or common aliases).'
            )
        if not content:
            raise ConversationParseError("Every turn must have content after the role.")
        turns.append({"role": role, "content": content})

    if not turns:
        raise ConversationParseError("No conversation turns found.")

    return ParsedConversation(turns=turns, conversation_id=None, format_detected="text")


def _parse_json_payload(payload: Any) -> ParsedConversation:
    conversation_id = _extract_conversation_id(payload)
    turns_payload = _extract_turns(payload)
    if not turns_payload:
        raise ConversationParseError(
            "JSON does not contain a recognizable conversation. "
            "Expected a list of turns or an object with turns/messages/conversation/history."
        )

    turns: List[Dict[str, str]] = []
    for index, item in enumerate(turns_payload):
        if isinstance(item, str):
            if not item.strip():
                continue
            turns.append({"role": "user" if index % 2 == 0 else "assistant", "content": item.strip()})
            continue
        if not isinstance(item, dict):
            raise ConversationParseError(f"Turn {index + 1} must be an object or string.")
        role = _normalize_role(_first_string(item, ROLE_KEYS))
        content = _extract_turn_content(item)
        if role is None:
            raise ConversationParseError(f"Turn {index + 1} is missing a recognizable role.")
        if not content:
            raise ConversationParseError(f"Turn {index + 1} is missing message content.")
        turns.append({"role": role, "content": content})

    if not turns:
        raise ConversationParseError("No conversation turns found in JSON.")

    return ParsedConversation(
        turns=turns,
        conversation_id=conversation_id,
        format_detected="json",
    )


def _extract_conversation_id(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    for key in ID_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_turns(payload: Any) -> List[Any]:
    if isinstance(payload, list):
        if payload and _looks_like_turn(payload[0]):
            return payload
        if payload and isinstance(payload[0], str):
            return payload
        nested = _find_turn_list(payload)
        if nested:
            return nested
        return []

    if isinstance(payload, dict):
        if _looks_like_turn(payload):
            return [payload]
        for key in TURN_CONTAINER_KEYS:
            value = payload.get(key)
            if isinstance(value, list) and value:
                if _looks_like_turn(value[0]) or isinstance(value[0], str):
                    return value
        nested = _find_turn_list(payload)
        if nested:
            return nested

    return []


def _find_turn_list(value: Any, depth: int = 0) -> List[Any]:
    if depth > 4:
        return []
    if isinstance(value, list):
        if value and (_looks_like_turn(value[0]) or isinstance(value[0], str)):
            return value
        for item in value:
            found = _find_turn_list(item, depth + 1)
            if found:
                return found
    elif isinstance(value, dict):
        for key in TURN_CONTAINER_KEYS:
            nested = value.get(key)
            if isinstance(nested, list) and nested:
                if _looks_like_turn(nested[0]) or isinstance(nested[0], str):
                    return nested
        for nested in value.values():
            found = _find_turn_list(nested, depth + 1)
            if found:
                return found
    return []


def _looks_like_turn(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    role = _normalize_role(_first_string(item, ROLE_KEYS))
    content = _extract_turn_content(item)
    return role is not None and bool(content)


def _extract_turn_content(item: Dict[str, Any]) -> str:
    direct = _first_string(item, CONTENT_KEYS)
    if direct:
        return direct

    nested_message = item.get("message")
    if isinstance(nested_message, dict):
        nested_content = _first_string(nested_message, CONTENT_KEYS)
        if nested_content:
            return nested_content

    for key in ("parts", "segments"):
        parts = item.get(key)
        if isinstance(parts, list):
            texts = []
            for part in parts:
                if isinstance(part, str) and part.strip():
                    texts.append(part.strip())
                elif isinstance(part, dict):
                    part_text = _first_string(part, CONTENT_KEYS)
                    if part_text:
                        texts.append(part_text)
            if texts:
                return "\n".join(texts)

    return ""


def _first_string(item: Dict[str, Any], keys: Sequence[str]) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_role(raw: str) -> Optional[str]:
    if not raw:
        return None
    normalized = re.sub(r"[^a-z0-9]+", "", raw.strip().lower())
    if normalized in ROLE_ALIASES:
        return ROLE_ALIASES[normalized]
    if normalized in VALID_ROLES:
        return normalized
    return None
