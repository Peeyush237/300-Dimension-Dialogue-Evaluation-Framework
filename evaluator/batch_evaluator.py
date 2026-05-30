from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
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
        self._load_env_file()
        self.model_name = model_name or os.getenv("MODEL_NAME", "llama-3.1-8b-instant")
        self.batch_size = int(batch_size or os.getenv("BATCH_SIZE", 20))
        self.max_concurrent_requests = int(max_concurrent_requests or os.getenv("MAX_CONCURRENT_REQUESTS", 2))
        self.request_delay = float(os.getenv("REQUEST_DELAY_SECONDS", "0"))
        self.max_clusters_per_run = int(os.getenv("MAX_CLUSTERS_PER_RUN", "0"))
        self.timeout_seconds = timeout_seconds
        self.api_key = os.getenv("GROQ_API_KEY", "")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY is required to run BatchEvaluator.")
        self.base_url = "https://api.groq.com/openai/v1"

    @staticmethod
    def _load_env_file() -> None:
        env_path = Path(__file__).resolve().parents[1] / ".env"
        if not env_path.exists():
            return
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

    async def evaluate_clusters(
        self, conversation_text: str, cluster_map: Dict[int, List[str]]
    ) -> List[BatchResult]:
        if self.max_clusters_per_run > 0:
            cluster_items = list(cluster_map.items())[: self.max_clusters_per_run]
        else:
            cluster_items = list(cluster_map.items())
        semaphore = asyncio.Semaphore(self.max_concurrent_requests)
        tasks = [
            self._evaluate_cluster(cluster_id, conversation_text, facets, semaphore)
            for cluster_id, facets in cluster_items
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
            if self.request_delay > 0:
                await asyncio.sleep(self.request_delay)
            payload = self._build_payload(conversation_text, facets)
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
            timeout = httpx.Timeout(self.timeout_seconds)
            async with httpx.AsyncClient(base_url=self.base_url, timeout=timeout) as client:
                response = await self._post_with_retry(client, headers, payload)
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                parsed = self._parse_json(content)
                scores = parsed.get("scores", [])
            return BatchResult(cluster_id=cluster_id, scores=scores)

    async def _post_with_retry(
        self,
        client: httpx.AsyncClient,
        headers: Dict[str, str],
        payload: Dict[str, Any],
        max_attempts: int = 4,
    ) -> httpx.Response:
        backoff = 1.0
        for attempt in range(max_attempts):
            response = await client.post("/chat/completions", headers=headers, json=payload)
            if response.status_code in {429, 500, 502, 503, 504}:
                if attempt == max_attempts - 1:
                    response.raise_for_status()
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        await asyncio.sleep(float(retry_after))
                    except ValueError:
                        await asyncio.sleep(backoff)
                else:
                    await asyncio.sleep(backoff)
                backoff *= 2
                continue
            response.raise_for_status()
            return response
        return response

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
