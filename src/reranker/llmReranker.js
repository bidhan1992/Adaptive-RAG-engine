import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { env } from "../config/env.js";

let rerankChain;

function getRerankChain() {
  if (rerankChain) return rerankChain;
  if (!env.openaiApiKey) return null;

  const llm = new ChatOpenAI({
    apiKey: env.openaiApiKey,
    model: env.openaiModel,
    temperature: 0
  });

  const prompt = PromptTemplate.fromTemplate(
    [
      "You are a retrieval reranker.",
      "Given query and candidate chunks, return strict JSON only:",
      "{\"scores\": [{\"chunk_id\": \"...\", \"score\": 0.0}]}",
      "Score each chunk from 0 to 1 by relevance.",
      "Query: {query}",
      "Candidates:",
      "{candidates}"
    ].join("\n")
  );

  rerankChain = RunnableSequence.from([
    prompt,
    llm
  ]);

  return rerankChain;
}

function fallbackRerank(candidates) {
  return candidates.map((c) => ({ ...c, rerank_score: c.hybrid_score }));
}

export async function rerank(query, candidates, topK = 5) {
  const chain = getRerankChain();
  if (!chain || !candidates.length) {
    return fallbackRerank(candidates).slice(0, topK);
  }

  const payload = candidates
    .map((c) => JSON.stringify({ chunk_id: c.chunk_id, text: c.text }))
    .join("\n");

  try {
    const output = await chain.invoke({ query, candidates: payload });
    const text = output.content?.toString?.() || output.text?.toString?.() || "";
    const parsed = JSON.parse(text);
    const scoreMap = new Map((parsed.scores || []).map((s) => [s.chunk_id, Number(s.score || 0)]));

    const ranked = candidates.map((c) => ({
      ...c,
      rerank_score: scoreMap.get(c.chunk_id) ?? c.hybrid_score
    }));

    ranked.sort((a, b) => b.rerank_score - a.rerank_score);
    return ranked.slice(0, topK);
  } catch {
    return fallbackRerank(candidates).slice(0, topK);
  }
}
