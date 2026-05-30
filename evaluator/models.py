from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class FacetScore(BaseModel):
    facet_name: str
    score: Optional[Literal[1, 2, 3, 4, 5]]
    confidence: float
    reason: str
    scoreable: bool
    category: str


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class EvaluationRequest(BaseModel):
    conversation_id: Optional[str] = None
    turns: Optional[List[ConversationTurn]] = None
    raw_input: Optional[str] = Field(
        default=None,
        description="Plain text or JSON conversation payload when structured turns are not provided.",
    )

    @model_validator(mode="after")
    def ensure_input_present(self) -> "EvaluationRequest":
        has_turns = bool(self.turns)
        has_raw = bool(self.raw_input and self.raw_input.strip())
        if has_turns and has_raw:
            return self
        if not has_turns and not has_raw:
            raise ValueError("Provide either turns or raw_input.")
        return self


class ParseConversationRequest(BaseModel):
    raw_input: str


class ParseConversationResponse(BaseModel):
    conversation_id: Optional[str]
    turns: List[ConversationTurn]
    format_detected: str


class EvaluationResult(BaseModel):
    conversation_id: str
    total_facets: int
    scoreable_facets: int
    scores: List[FacetScore]
