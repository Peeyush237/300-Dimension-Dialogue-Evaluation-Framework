from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
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

allowed_origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

classifier: FacetClassifier = load_default_classifier()
pipeline = EvaluationPipeline(classifier)


def _format_sse(event: str, payload: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


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


@app.post("/evaluate/stream")
async def evaluate_stream(request: EvaluationRequest) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        try:
            turns, parsed_id = pipeline.resolve_turns(request.turns, request.raw_input)
            conversation_id = request.conversation_id or parsed_id
        except (ConversationParseError, ConversationValidationError, ValidationError) as exc:
            yield _format_sse("error", {"detail": str(exc)})
            return
        try:
            async for event, payload in pipeline.evaluate_stream(conversation_id, turns):
                yield _format_sse(event, payload)
        except Exception as exc:  # noqa: BLE001
            yield _format_sse("error", {"detail": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


frontend_dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
