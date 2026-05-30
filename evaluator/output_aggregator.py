from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd

from evaluator.models import EvaluationResult, FacetScore


@dataclass(frozen=True)
class AggregationSummary:
    total_facets: int
    scoreable_facets: int
    unscoreable_facets: int


class OutputAggregator:
    def __init__(self, facets_df: pd.DataFrame) -> None:
        self.facets_df = facets_df.copy()
        self._validate_facets_df()

    def _validate_facets_df(self) -> None:
        required = {
            "facet_name_clean",
            "scoreable",
            "category",
        }
        missing = required - set(self.facets_df.columns)
        if missing:
            raise ValueError(f"Facets metadata missing required columns: {sorted(missing)}")

    def aggregate(
        self,
        conversation_id: str,
        batch_results: List[Dict[str, Any]],
        not_scoreable_reason: str = "not_inferable_from_conversation_text",
    ) -> EvaluationResult:
        score_map: Dict[str, Dict[str, Any]] = {}
        for result in batch_results:
            for entry in result.get("scores", []):
                facet_name = entry.get("facet_name")
                if facet_name:
                    score_map[facet_name] = entry

        scores: List[FacetScore] = []
        for _, row in self.facets_df.iterrows():
            facet_name = row["facet_name_clean"]
            scoreable = bool(row["scoreable"])
            category = row["category"]
            if scoreable and facet_name in score_map:
                scored = score_map[facet_name]
                scores.append(
                    FacetScore(
                        facet_name=facet_name,
                        score=scored.get("score"),
                        confidence=float(scored.get("confidence", 0.0)),
                        reason=str(scored.get("reason", "")),
                        scoreable=True,
                        category=category,
                    )
                )
            else:
                scores.append(
                    FacetScore(
                        facet_name=facet_name,
                        score=None,
                        confidence=0.0,
                        reason=not_scoreable_reason,
                        scoreable=False,
                        category=category,
                    )
                )

        total_facets = len(scores)
        scoreable_facets = sum(1 for item in scores if item.scoreable)
        return EvaluationResult(
            conversation_id=conversation_id,
            total_facets=total_facets,
            scoreable_facets=scoreable_facets,
            scores=scores,
        )

    def write_outputs(
        self,
        evaluation: EvaluationResult,
        output_json: Path,
        output_csv: Path,
    ) -> None:
        output_json.write_text(evaluation.model_dump_json(indent=2), encoding="utf-8")
        data = [score.model_dump() for score in evaluation.scores]
        pd.DataFrame(data).to_csv(output_csv, index=False)

    def summary(self) -> AggregationSummary:
        total = int(len(self.facets_df))
        scoreable = int(self.facets_df["scoreable"].sum())
        return AggregationSummary(
            total_facets=total,
            scoreable_facets=scoreable,
            unscoreable_facets=total - scoreable,
        )
