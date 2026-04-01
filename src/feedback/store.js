import { pool } from "../db/postgres.js";

export async function recordFeedback({
  sessionId,
  query,
  answer,
  helpful,
  chunkIds,
  comment
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const eventRes = await client.query(
      `
      INSERT INTO feedback_events (session_id, query, answer, helpful, comment)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [sessionId, query, answer, helpful, comment || null]
    );

    const feedbackId = eventRes.rows[0].id;

    for (const chunkId of chunkIds || []) {
      await client.query(
        "INSERT INTO feedback_chunks (feedback_id, chunk_id) VALUES ($1, $2)",
        [feedbackId, chunkId]
      );

      await client.query(
        "INSERT INTO chunk_stats (chunk_id, upvotes, downvotes) VALUES ($1, 0, 0) ON CONFLICT (chunk_id) DO NOTHING",
        [chunkId]
      );

      await client.query(
        helpful
          ? "UPDATE chunk_stats SET upvotes = upvotes + 1 WHERE chunk_id = $1"
          : "UPDATE chunk_stats SET downvotes = downvotes + 1 WHERE chunk_id = $1",
        [chunkId]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getChunkWeights(chunkIds) {
  if (!chunkIds.length) return new Map();

  const res = await pool.query(
    "SELECT chunk_id, upvotes, downvotes FROM chunk_stats WHERE chunk_id = ANY($1)",
    [chunkIds]
  );

  const weights = new Map();
  for (const row of res.rows) {
    const up = Number(row.upvotes || 0);
    const down = Number(row.downvotes || 0);
    const total = up + down;
    if (total === 0) {
      weights.set(row.chunk_id, 1);
      continue;
    }

    const quality = (up - down) / total;
    const weight = Math.max(0.7, Math.min(1.3, 1 + 0.2 * quality));
    weights.set(row.chunk_id, weight);
  }

  return weights;
}

export async function getMetrics() {
  const totals = await pool.query(`
    SELECT
      COUNT(*)::int AS total_feedback,
      COALESCE(SUM(CASE WHEN helpful THEN 1 ELSE 0 END), 0)::int AS positive_feedback
    FROM feedback_events
  `);

  const coverage = await pool.query("SELECT COUNT(*)::int AS chunk_feedback_coverage FROM chunk_stats");

  const total = totals.rows[0].total_feedback;
  const positive = totals.rows[0].positive_feedback;

  return {
    total_feedback: total,
    positive_feedback: positive,
    satisfaction_rate: total > 0 ? positive / total : 0,
    chunk_feedback_coverage: coverage.rows[0].chunk_feedback_coverage
  };
}
