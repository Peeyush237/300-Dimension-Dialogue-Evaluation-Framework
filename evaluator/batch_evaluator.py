from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List

import httpx

from evaluator.prompts import EVALUATOR_SYSTEM_PROMPT, EVALUATOR_USER_PROMPT


@dataclass(frozen=True)
class BatchResult:
    cluster_id: int
    scores: List[Dict[str, Any]]


class BatchEvaluator:
    def __init__(
        self,
        model_name: str | None = None,
        batch_size: int | None = None,
        max_concurrent_requests: int | None = None,
        timeout_seconds: int = 60,
    ) -> None:
        self.model_name = model_name or os.getenv("MODEL_NAME", "llama-3.1-8b-instant")
        self.batch_size = int(batch_size or os.getenv("BATCH_SIZE", 20))
        self.max_concurrent_requests = int(max_concurrent_requests or os.getenv("MAX_CONCURRENT_REQUESTS", 5))
        self.timeout_seconds = timeout_seconds
        self.api_key = os.getenv("GROQ_API_KEY", "")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY is required to run BatchEvaluator.")
        self.base_url = "https://api.groq.com/openai/v1"

    async def evaluate_clusters(
        self, conversation_text: str, cluster_map: Dict[int, List[str]]
    ) -> List[BatchResult]:
        semaphore = asyncio.Semaphore(self.max_concurrent_requests)
        tasks = [
            self._evaluate_cluster(cluster_id, conversation_text, facets, semaphore)
            for cluster_id, facets in cluster_map.items()
        ]
        return await asyncio.gather(*tasks)

    async def _evaluate_cluster(
        self,
        cluster_id: int,
        conversation_text: str,
        facets: List[str],
        semaphore: asyncio.Semaphore,
    ) -> BatchResult:
        async with semaphore:
            payload = self._build_payload(conversation_text, facets)
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
                parsed = self._parse_json(content)
                scores = parsed.get("scores", [])
            return BatchResult(cluster_id=cluster_id, scores=scores)

    def _build_payload(self, conversation_text: str, facets: List[str]) -> Dict[str, Any]:
        facets_list = "\n".join(f"- {facet}" for facet in facets)
        prompt = EVALUATOR_USER_PROMPT.format(conversation_text=conversation_text, facets_list=facets_list)
        return {
            "model": self.model_name,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": EVALUATOR_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
        }

    @staticmethod
    def _parse_json(text: str) -> Dict[str, Any]:
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("LLM response was not valid JSON.") from exc
