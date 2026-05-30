from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Dict, List

from evaluator.batch_evaluator import BatchEvaluator
from evaluator.facet_classifier import FacetClassifier, load_default_classifier
from evaluator.models import EvaluationResult
from evaluator.output_aggregator import OutputAggregator


class EvaluationPipeline:
    def __init__(self, classifier: FacetClassifier | None = None) -> None:
        self.classifier = classifier or load_default_classifier()
        self.batch_evaluator = BatchEvaluator()
        self.aggregator = OutputAggregator(self.classifier.get_scoreable_metadata().assign(
            scoreable=True
        ))
        self._full_facets_df = self.classifier._df.copy()

    @staticmethod
    def _format_conversation(turns: List[Dict[str, str]]) -> str:
        return "\n".join(f"{turn['role']}: {turn['content']}" for turn in turns)

    def _cluster_map(self) -> Dict[int, List[str]]:
        groups = self.classifier.get_cluster_groups()
        return {group.cluster_id: group.facets for group in groups}

    async def evaluate(self, conversation_id: str, turns: List[Dict[str, str]]) -> EvaluationResult:
        conversation_text = self._format_conversation(turns)
        cluster_map = self._cluster_map()
        batch_results = await self.batch_evaluator.evaluate_clusters(conversation_text, cluster_map)
        batch_payloads = [
            {"scores": result.scores} for result in batch_results
        ]
        full_facets = self.classifier._df.copy()
        aggregator = OutputAggregator(full_facets)
        return aggregator.aggregate(conversation_id, batch_payloads)

    def evaluate_sync(self, conversation_id: str, turns: List[Dict[str, str]]) -> EvaluationResult:
        return asyncio.run(self.evaluate(conversation_id, turns))

    def write_outputs(self, result: EvaluationResult, output_dir: Path) -> None:
        output_dir.mkdir(parents=True, exist_ok=True)
        json_path = output_dir / f"{result.conversation_id}.json"
        csv_path = output_dir / f"{result.conversation_id}.csv"
        self.aggregator.write_outputs(result, json_path, csv_path)
