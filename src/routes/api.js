import express from "express";
import { z } from "zod";
import { askQuestion } from "../orchestration/ragChain.js";
import { getMetrics, recordFeedback } from "../feedback/store.js";

const router = express.Router();

const askSchema = z.object({
  query: z.string().min(3),
  session_id: z.string().optional(),
  top_k: z.number().int().min(1).max(15).optional()
});

const feedbackSchema = z.object({
  session_id: z.string(),
  query: z.string(),
  answer: z.string(),
  chunk_ids: z.array(z.string()).default([]),
  helpful: z.boolean(),
  comment: z.string().nullable().optional()
});

router.get("/health", async (_req, res) => {
  res.json({ status: "ok" });
});

router.post("/ask", async (req, res) => {
  try {
    const parsed = askSchema.parse(req.body);
    const result = await askQuestion({
      query: parsed.query,
      sessionId: parsed.session_id,
      topK: parsed.top_k || 5
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || "Bad request" });
  }
});

router.post("/feedback", async (req, res) => {
  try {
    const parsed = feedbackSchema.parse(req.body);
    await recordFeedback({
      sessionId: parsed.session_id,
      query: parsed.query,
      answer: parsed.answer,
      helpful: parsed.helpful,
      chunkIds: parsed.chunk_ids,
      comment: parsed.comment || null
    });
    res.json({ status: "recorded" });
  } catch (error) {
    res.status(400).json({ error: error.message || "Bad request" });
  }
});

router.get("/metrics", async (_req, res) => {
  try {
    const metrics = await getMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch metrics" });
  }
});

export default router;
