import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkText } from "../src/data/chunker.js";
import { initPostgres, pool } from "../src/db/postgres.js";
import { ensureQdrantCollection, upsertVectors } from "../src/retrieval/hybridRetriever.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadDocs() {
  const file = path.join(__dirname, "..", "data", "sample_docs.jsonl");
  const raw = await fs.readFile(file, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildChunks(docs) {
  const chunks = [];
  for (const doc of docs) {
    const pieces = chunkText(doc.text);
    pieces.forEach((text, idx) => {
      chunks.push({
        chunk_id: `${doc.id}_chunk_${idx}`,
        title: doc.title,
        source: doc.source,
        text
      });
    });
  }
  return chunks;
}

async function writeChunksToPostgres(chunks) {
  await pool.query("TRUNCATE TABLE chunks");
  for (const c of chunks) {
    await pool.query(
      "INSERT INTO chunks (chunk_id, title, source, text) VALUES ($1, $2, $3, $4)",
      [c.chunk_id, c.title, c.source, c.text]
    );
  }
}

async function main() {
  await initPostgres();
  const docs = await loadDocs();
  const chunks = buildChunks(docs);

  await writeChunksToPostgres(chunks);
  await ensureQdrantCollection(384);
  await upsertVectors(chunks);

  console.log(`Indexed ${chunks.length} chunks into Postgres + Qdrant.`);
  await pool.end();
}

main().catch(async (error) => {
  console.error("Indexing failed", error);
  await pool.end();
  process.exit(1);
});
