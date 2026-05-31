from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Dict, List, Tuple, AsyncIterator, Any

from evaluator.batch_evaluator import BatchEvaluator
from evaluator.conversation_parser import ConversationParseError, parse_conversation_input
from evaluator.conversation_validator import ConversationValidator
from evaluator.facet_classifier import FacetClassifier, load_default_classifier
from evaluator.models import ConversationTurn, EvaluationResult
from evaluator.output_aggregator import OutputAggregator


class EvaluationPipeline:
    def __init__(self, classifier: FacetClassifier | None = None) -> None:
        self.classifier = classifier or load_default_classifier()
        self.batch_evaluator = BatchEvaluator()
        self.conversation_validator = ConversationValidator()
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

    def resolve_turns(
        self,
        turns: List[ConversationTurn] | None,
        raw_input: str | None,
    ) -> Tuple[List[Dict[str, str]], str | None]:
        if turns:
            return [turn.model_dump() for turn in turns], None
        if raw_input and raw_input.strip():
            parsed = parse_conversation_input(raw_input)
            return parsed.turns, parsed.conversation_id
        raise ConversationParseError("Provide either turns or raw_input.")

    async def validate_conversation(self, turns: List[Dict[str, str]]) -> None:
        conversation_text = self._format_conversation(turns)
        result = await self.conversation_validator.validate(turns, conversation_text)
        self.conversation_validator.ensure_valid(result)

    async def evaluate(
        self,
        conversation_id: str | None,
        turns: List[Dict[str, str]],
    ) -> EvaluationResult:
        await self.validate_conversation(turns)
        conversation_text = self._format_conversation(turns)
        cluster_map = self._cluster_map()
        batch_results = await self.batch_evaluator.evaluate_clusters(conversation_text, cluster_map)
        batch_payloads = [
            {"scores": result.scores} for result in batch_results
        ]
        full_facets = self.classifier._df.copy()
        aggregator = OutputAggregator(full_facets)
        resolved_id = conversation_id or f"eval-{abs(hash(conversation_text)) % 10**10}"
        return aggregator.aggregate(resolved_id, batch_payloads)

    async def evaluate_stream(
        self,
        conversation_id: str | None,
        turns: List[Dict[str, str]],
    ) -> AsyncIterator[Tuple[str, Dict[str, Any]]]:
        yield "status", {"stage": "validating"}
        await self.validate_conversation(turns)
        conversation_text = self._format_conversation(turns)
        cluster_map = self._cluster_map()
        total_clusters = len(cluster_map)
        yield "status", {"stage": "scoring", "total_clusters": total_clusters}
        batch_payloads: List[Dict[str, Any]] = []
        completed = 0
        async for result in self.batch_evaluator.evaluate_clusters_stream(conversation_text, cluster_map):
            completed += 1
            batch_payloads.append({"scores": result.scores})
            yield "progress", {
                "completed": completed,
                "total": total_clusters,
                "cluster_id": result.cluster_id,
            }
        full_facets = self.classifier._df.copy()
        aggregator = OutputAggregator(full_facets)
        resolved_id = conversation_id or f"eval-{abs(hash(conversation_text)) % 10**10}"
        final = aggregator.aggregate(resolved_id, batch_payloads)
        yield "complete", final.model_dump()

    def evaluate_sync(
        self,
        conversation_id: str | None,
        turns: List[Dict[str, str]],
    ) -> EvaluationResult:
        return asyncio.run(self.evaluate(conversation_id, turns))

    def write_outputs(self, result: EvaluationResult, output_dir: Path) -> None:
        output_dir.mkdir(parents=True, exist_ok=True)
        json_path = output_dir / f"{result.conversation_id}.json"
        csv_path = output_dir / f"{result.conversation_id}.csv"
        self.aggregator.write_outputs(result, json_path, csv_path)
