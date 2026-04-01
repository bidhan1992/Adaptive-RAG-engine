import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: env.postgresUrl });

export async function initPostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      text TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback_events (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      query TEXT NOT NULL,
      answer TEXT NOT NULL,
      helpful BOOLEAN NOT NULL,
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback_chunks (
      feedback_id BIGINT NOT NULL REFERENCES feedback_events(id),
      chunk_id TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunk_stats (
      chunk_id TEXT PRIMARY KEY,
      upvotes INT DEFAULT 0,
      downvotes INT DEFAULT 0
    );
  `);
}
