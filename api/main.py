from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import pandas as pd
from fastapi import FastAPI

from evaluator.facet_classifier import FacetClassifier, load_default_classifier
from evaluator.models import EvaluationRequest, EvaluationResult
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


@app.post("/evaluate")
async def evaluate(request: EvaluationRequest) -> EvaluationResult:
    result = await pipeline.evaluate(request.conversation_id, [turn.model_dump() for turn in request.turns])
    return result
