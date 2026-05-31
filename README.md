# Ahoum Conversation Evaluator

Ahoum evaluates multi-turn conversations across a large facet set, returning a score, confidence, and reason per facet. It clusters scoreable facets for scalable batch evaluation and ships a React UI with streaming progress updates.

## Live demo

**Deployed UI (Vercel):** https://300-dimension-dialogue-evaluation-f.vercel.app/

Open the link to paste or upload a conversation, run evaluation, and view streamed facet scores. The frontend connects to the hosted API on Render.

## Architecture

```mermaid
flowchart LR
  UI[React + Vite UI] -->|POST /evaluate or /evaluate/stream| API[FastAPI]
  API --> Parser[Conversation Parser]
  API --> Validator[Conversation Validator]
  API --> Classifier[Facet Classifier]
  Classifier -->|scoreable facets only| Clusters[Facet Clusters]
  Clusters --> Evaluator[Batch Evaluator]
  Evaluator --> Groq[Groq Chat Completions]
  Evaluator --> Aggregator[Output Aggregator]
  Aggregator --> API
  API --> UI
```

## Setup

### Local (Python + Node)

1. Create a `.env` from the example and add your Groq key:

```powershell
copy .env.example .env
```

2. Start the API:

```powershell
uvicorn api.main:app --reload --port 8000
```

3. Start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

### Docker

```powershell
docker compose up --build
```

Open http://localhost:8080.

Stop with:

```powershell
docker compose down
```

## Why this scales to 5000 facets

- Only scoreable facets are clustered. Unscoreable facets are never sent to the LLM.
- Clusters are built with sentence-transformers (`all-MiniLM-L6-v2`, with TF-IDF fallback) and KMeans to keep semantically similar facets together.
- Clustering groups roughly 20 to 25 facets per batch, keeping each request small and stable.
- The number of clusters grows linearly with the number of facets, so capacity scales without redesign.
- Rate control is handled through batch size, concurrency, and request delay settings.

## Example JSON

### Input

```json
{
  "conversation_id": "demo-001",
  "raw_input": "user: How can I reset my password?\nassistant: Open Settings, then click Reset Password."
}
```

### Output (excerpt)

```json
{
  "conversation_id": "demo-001",
  "total_facets": 399,
  "scoreable_facets": 210,
  "scores": [
    {
      "facet_name": "clarity",
      "category": "linguistic",
      "score": 4,
      "confidence": 0.82,
      "reason": "The steps are concise and unambiguous.",
      "scoreable": true
    },
    {
      "facet_name": "domain_accuracy",
      "category": "cognitive",
      "score": 5,
      "confidence": 0.88,
      "reason": "Guidance matches common password reset flows.",
      "scoreable": true
    }
  ]
}
```

## Design decisions

- **Clustered evaluation**: scoreable facets are grouped and evaluated in batches for scalability.
- **Streaming UX**: `/evaluate/stream` emits progress events to keep the UI responsive.
- **Strict JSON output**: model output is constrained to JSON to reduce parsing failures.
- **Fail-safe aggregation**: unscoreable facets are filled with `score=None` and a default reason.

## Issues encountered and fixes

- **Groq rate limits (429)**: mitigated with lower concurrency, request delays, and batch size controls.
- **Invalid JSON from model**: added JSON-only prompt constraints and a tolerant JSON parser.
- **Streaming not visible in dev**: added a dedicated proxy for `/evaluate/stream`.

## Notes

- For free-tier Groq, keep concurrency at 1 and use small batch sizes.
- `MAX_CLUSTERS_PER_RUN` can limit runtime for demos, but it returns partial results.
