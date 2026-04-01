import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3000),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
  qdrantApiKey: process.env.QDRANT_API_KEY || "",
  qdrantCollection: process.env.QDRANT_COLLECTION || "knowledge_chunks",
  postgresUrl: process.env.POSTGRES_URL || "",
  embeddingModel: process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2",
  vectorBm25Alpha: Number(process.env.VECTOR_BM25_ALPHA || 0.65)
};

if (!env.postgresUrl) {
  throw new Error("POSTGRES_URL is required.");
}
