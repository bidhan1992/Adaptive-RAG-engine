import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { initPostgres } from "./db/postgres.js";
import apiRouter from "./routes/api.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/", apiRouter);

async function boot() {
  await initPostgres();

  app.listen(env.port, () => {
    console.log(`Node API running on http://localhost:${env.port}`);
  });
}

boot().catch((error) => {
  console.error("Failed to boot server", error);
  process.exit(1);
});
