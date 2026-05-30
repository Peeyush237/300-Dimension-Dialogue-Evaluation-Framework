from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel


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
    conversation_id: str
    turns: List[ConversationTurn]


class EvaluationResult(BaseModel):
    conversation_id: str
    total_facets: int
    scoreable_facets: int
    scores: List[FacetScore]
