# AI Knowledge Assistant Node Version

Node.js implementation of the same retrieval system with:

- Express API
- Transformers.js embeddings
- Qdrant vector similarity search
- Hybrid retrieval (vector + lexical PostgreSQL rank)
- LangChain orchestration (query rewrite + answer generation)
- LLM-based reranking via LangChain
- LLM-as-Judge answer validation (faithfulness scoring)
- PostgreSQL feedback loop and metrics
- Streamlit UI kept separate, calling this Node API

## Structure

ai-knowledge-assistant-node/
- data/
- scripts/
- src/config
- src/data
- src/db
- src/embeddings
- src/retrieval
- src/reranker
- src/orchestration
- src/feedback
- src/routes
- src/server.js

## Prerequisites

- Node.js 20+
- PostgreSQL
- Qdrant running locally or remote

## 1) Setup

1. Install dependencies

npm install

2. Create env file

cp .env.example .env

3. Update .env values

- POSTGRES_URL must point to your database
- QDRANT_URL must point to your Qdrant instance
- OPENAI_API_KEY is optional but recommended

## 2) Index data

npm run index

This loads docs from data/sample_docs.jsonl, chunks them, stores chunks in PostgreSQL, and upserts vectors into Qdrant.

## 3) Run API

npm run dev

Server URL:

http://localhost:3000

## Endpoints

- GET /health
- POST /ask
- POST /feedback
- GET /metrics

Ask payload:

{
  "query": "How does reranking improve retrieval quality?",
  "session_id": "demo-session-1",
  "top_k": 5
}

Ask response includes:

{
  "session_id": "...",
  "answer": "...",
  "query_rewrite": "...",
  "chunks": [...],
  "validation": {
    "faithfulness": 0.92,
    "issues": [],
    "verdict": "pass"
  },
  "trace": {
    "retrieved_count": 5,
    "reranked_count": 5,
    "history_turns": 1
  }
}

Validation verdicts: pass (faithfulness >= 0.8), partial (0.5-0.8), fail (< 0.5), skipped (no API key), error (LLM failure).

## Streamlit client (separate)

The existing Streamlit app in the Python folder can call this API. Ensure its API base URL is set to:

http://127.0.0.1:3000

Then run Streamlit from the Python project as before.

## Notes

- If OPENAI_API_KEY is missing, answer generation, reranking, and validation use fallback behavior.
- Validation returns verdict "skipped" when no API key is set.
- Transformers.js runs embedding locally and can be slower on first startup due to model download.
- For larger datasets, batch upserts and asynchronous embedding workers should be added.

## What problem this system is solving

This project solves a common RAG reliability problem: pure vector search can miss exact term matches, while pure keyword search can miss semantic intent. The system combines both, reranks results with an LLM, and uses user feedback to gradually improve which chunks are favored.

At a high level, it tries to deliver:

- More relevant retrieval from mixed search signals (semantic + lexical)
- Better final context ordering before answer generation
- Grounded answers with traceable evidence chunks
- LLM-as-Judge validation to detect hallucinations before returning answers
- A feedback loop that adjusts retrieval quality over time

## Flow diagram

```mermaid
flowchart TD
  A[Source docs JSONL] --> B[Chunk text]
  B --> C[Store chunks in PostgreSQL]
  B --> D[Create embeddings with Transformers.js]
  D --> E[Upsert vectors into Qdrant]

  U[Client query via POST /ask] --> Q[Load session history]
  Q --> R{OPENAI_API_KEY present?}
  R -->|Yes| S[Rewrite query with LangChain + OpenAI]
  R -->|No| T[Use original query]
  S --> H
  T --> H

  H[Hybrid retrieval] --> V[Vector search in Qdrant]
  H --> L[Lexical rank in PostgreSQL]
  V --> M[Merge candidates]
  L --> M
  M --> N[Normalize scores + combine by alpha]
  N --> O[Apply chunk weights from feedback]
  O --> P[Top K hybrid candidates]

  P --> X{OPENAI_API_KEY present?}
  X -->|Yes| Y[LLM rerank candidates]
  X -->|No| Z[Fallback rerank by hybrid score]
  Y --> AA[Build context from top chunks]
  Z --> AA

  AA --> AB{OPENAI_API_KEY present?}
  AB -->|Yes| AC[Generate grounded answer with LangChain + OpenAI]
  AB -->|No| AD[Return fallback grounded response]
  AC --> AF{OPENAI_API_KEY present?}
  AD --> AF
  AF -->|Yes| AG[LLM-as-Judge validates faithfulness]
  AF -->|No| AH[Validation skipped]
  AG --> AE[Return answer + validation + chunks + trace]
  AH --> AE

  F[Client feedback via POST /feedback] --> G[Store feedback event]
  G --> I[Update chunk upvotes/downvotes]
  I --> O

  J[GET /metrics] --> K[Feedback totals and satisfaction rate]
```
