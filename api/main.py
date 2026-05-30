from __future__ import annotations

from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from evaluator.conversation_parser import ConversationParseError, parse_conversation_input
from evaluator.conversation_validator import ConversationValidationError
from evaluator.facet_classifier import FacetClassifier, load_default_classifier
from evaluator.models import (
    EvaluationRequest,
    EvaluationResult,
    ParseConversationRequest,
    ParseConversationResponse,
)
from evaluator.pipeline import EvaluationPipeline

app = FastAPI(title="Ahoum Conversation Evaluator")

classifier: FacetClassifier = load_default_classifier()
pipeline = EvaluationPipeline(classifier)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/facets")
async def get_facets() -> Dict[str, Any]:
    return {"facets": classifier._df.to_dict(orient="records")}


@app.post("/parse-conversation", response_model=ParseConversationResponse)
async def parse_conversation(request: ParseConversationRequest) -> ParseConversationResponse:
    try:
        parsed = parse_conversation_input(request.raw_input)
    except ConversationParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ParseConversationResponse(
        conversation_id=parsed.conversation_id,
        turns=parsed.turns,
        format_detected=parsed.format_detected,
    )


@app.post("/evaluate")
async def evaluate(request: EvaluationRequest) -> EvaluationResult:
    try:
        turns, parsed_id = pipeline.resolve_turns(request.turns, request.raw_input)
        conversation_id = request.conversation_id or parsed_id
        return await pipeline.evaluate(conversation_id, turns)
    except ConversationParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ConversationValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
