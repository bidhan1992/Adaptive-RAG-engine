import crypto from "node:crypto";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { env } from "../config/env.js";
import { hybridSearch } from "../retrieval/hybridRetriever.js";
import { rerank } from "../reranker/llmReranker.js";

const memoryStore = new Map();

function getHistory(sessionId) {
  if (!memoryStore.has(sessionId)) memoryStore.set(sessionId, []);
  return memoryStore.get(sessionId);
}

function addTurn(sessionId, user, assistant) {
  const history = getHistory(sessionId);
  history.push({ user, assistant });
  if (history.length > 6) history.shift();
}

function buildContext(chunks) {
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] title=${c.title} source=${c.source} rerank_score=${Number(c.rerank_score || 0).toFixed(4)}\n${c.text}`
    )
    .join("\n\n");
}

async function rewriteQuery(query, history) {
  if (!env.openaiApiKey) return query.trim();

  const llm = new ChatOpenAI({ apiKey: env.openaiApiKey, model: env.openaiModel, temperature: 0 });
  const chain = RunnableSequence.from([
    PromptTemplate.fromTemplate(
      "Rewrite the query to be self-contained while preserving intent. Return only rewritten query.\nHistory:\n{history}\nQuery:\n{query}"
    ),
    llm
  ]);

  const hist = history.map((h) => `User: ${h.user}\nAssistant: ${h.assistant}`).join("\n");
  const out = await chain.invoke({ history: hist, query });
  return (out.content?.toString?.() || query).trim();
}

async function generateAnswer(query, history, context) {
  if (!env.openaiApiKey) {
    return [
      "Answer generated in fallback mode (no OPENAI_API_KEY).",
      "",
      `Question: ${query}`,
      "",
      "Grounded evidence:",
      context || "No context retrieved."
    ].join("\n");
  }

  const llm = new ChatOpenAI({ apiKey: env.openaiApiKey, model: env.openaiModel, temperature: 0.2 });

  const chain = RunnableSequence.from([
    PromptTemplate.fromTemplate(
      [
        "You are an AI knowledge assistant.",
        "Answer using only provided context when possible.",
        "If context is weak, say what is missing.",
        "",
        "History:",
        "{history}",
        "",
        "Context:",
        "{context}",
        "",
        "Question:",
        "{query}",
        "",
        "Provide:",
        "1) concise answer",
        "2) key evidence summary",
        "3) confidence high|medium|low"
      ].join("\n")
    ),
    llm
  ]);

  const hist = history.map((h) => `User: ${h.user}\nAssistant: ${h.assistant}`).join("\n");
  const out = await chain.invoke({ history: hist, context, query });
  return (out.content?.toString?.() || "").trim();
}

async function validateAnswer(query, answer, context) {
  if (!env.openaiApiKey) {
    return { faithfulness: null, issues: [], verdict: "skipped" };
  }

  const llm = new ChatOpenAI({ apiKey: env.openaiApiKey, model: env.openaiModel, temperature: 0 });

  const chain = RunnableSequence.from([
    PromptTemplate.fromTemplate(
      [
        "You are a strict answer validator (LLM-as-Judge).",
        "Check whether the answer is grounded in the provided context.",
        "Return strict JSON only:",
        '{"faithfulness": 0.0, "issues": ["..."], "verdict": "pass|fail|partial"}',
        "",
        "Rules:",
        "- faithfulness: 0 to 1, how much of the answer is supported by context.",
        "- issues: list unsupported or hallucinated claims. Empty list if none.",
        "- verdict: pass (faithfulness >= 0.8), partial (0.5-0.8), fail (< 0.5).",
        "",
        "Context:",
        "{context}",
        "",
        "Question:",
        "{query}",
        "",
        "Answer to validate:",
        "{answer}"
      ].join("\n")
    ),
    llm
  ]);

  try {
    const out = await chain.invoke({ context, query, answer });
    const text = out.content?.toString?.() || "";
    return JSON.parse(text);
  } catch {
    return { faithfulness: null, issues: [], verdict: "error" };
  }
}

export async function askQuestion({ query, sessionId, topK = 5 }) {
  const sid = sessionId || crypto.randomUUID();
  const history = getHistory(sid);

  const rewritten = await rewriteQuery(query, history);
  const retrieved = await hybridSearch(rewritten, topK);
  const reranked = await rerank(rewritten, retrieved, topK);

  const context = buildContext(reranked.slice(0, 4));
  const answer = await generateAnswer(rewritten, history, context);
  const validation = await validateAnswer(rewritten, answer, context);

  addTurn(sid, query, answer);

  return {
    session_id: sid,
    answer,
    query_rewrite: rewritten,
    chunks: reranked,
    validation,
    trace: {
      retrieved_count: retrieved.length,
      reranked_count: reranked.length,
      history_turns: history.length
    }
  };
}
