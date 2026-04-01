import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config/env.js";
import { embedText } from "../embeddings/transformerEmbedder.js";
import { pool } from "../db/postgres.js";
import { getChunkWeights } from "../feedback/store.js";

const qdrant = new QdrantClient({
  url: env.qdrantUrl,
  apiKey: env.qdrantApiKey || undefined
});

function minMaxNorm(values) {
  if (!values.length) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (Math.abs(hi - lo) < 1e-8) return values.map(() => 1);
  return values.map((v) => (v - lo) / (hi - lo));
}

async function lexicalSearch(query, limit) {
  const res = await pool.query(
    `
    SELECT
      chunk_id,
      title,
      source,
      text,
      ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', $1)) AS bm25_score
    FROM chunks
    ORDER BY bm25_score DESC
    LIMIT $2
    `,
    [query, limit]
  );
  return res.rows;
}

export async function hybridSearch(query, topK = 5) {
  const expandedK = Math.max(15, topK * 5);
  const queryVector = await embedText(query);

  const vectorRes = await qdrant.search(env.qdrantCollection, {
    vector: queryVector,
    limit: expandedK,
    with_payload: true
  });

  const lexicalRes = await lexicalSearch(query, expandedK);

  const candidates = new Map();

  for (const item of vectorRes) {
    const chunkId = String(item.payload.chunk_id);
    candidates.set(chunkId, {
      chunk_id: chunkId,
      title: item.payload.title,
      source: item.payload.source,
      text: item.payload.text,
      vector_raw: Number(item.score || 0),
      bm25_raw: 0
    });
  }

  for (const row of lexicalRes) {
    const existing = candidates.get(row.chunk_id);
    if (existing) {
      existing.bm25_raw = Number(row.bm25_score || 0);
    } else {
      candidates.set(row.chunk_id, {
        chunk_id: row.chunk_id,
        title: row.title,
        source: row.source,
        text: row.text,
        vector_raw: 0,
        bm25_raw: Number(row.bm25_score || 0)
      });
    }
  }

  const rows = Array.from(candidates.values());
  const vecNorm = minMaxNorm(rows.map((r) => r.vector_raw));
  const bm25Norm = minMaxNorm(rows.map((r) => r.bm25_raw));
  const weights = await getChunkWeights(rows.map((r) => r.chunk_id));

  const alpha = env.vectorBm25Alpha;

  const scored = rows.map((row, i) => {
    const base = alpha * vecNorm[i] + (1 - alpha) * bm25Norm[i];
    const weight = weights.get(row.chunk_id) ?? 1;
    const hybrid = base * weight;

    return {
      chunk_id: row.chunk_id,
      title: row.title,
      source: row.source,
      text: row.text,
      vector_score: vecNorm[i],
      bm25_score: bm25Norm[i],
      hybrid_score: hybrid
    };
  });

  scored.sort((a, b) => b.hybrid_score - a.hybrid_score);
  return scored.slice(0, topK);
}

export async function ensureQdrantCollection(vectorSize = 384) {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === env.qdrantCollection);

  if (!exists) {
    await qdrant.createCollection(env.qdrantCollection, {
      vectors: {
        size: vectorSize,
        distance: "Cosine"
      }
    });
  }
}

export async function upsertVectors(chunks) {
  const points = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const vector = await embedText(chunk.text);
    points.push({
      id: i + 1,
      vector,
      payload: {
        chunk_id: chunk.chunk_id,
        title: chunk.title,
        source: chunk.source,
        text: chunk.text
      }
    });
  }

  await qdrant.upsert(env.qdrantCollection, { points, wait: true });
}
