import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth.js";
import { jobs } from "./routes/jobs.js";
import { languages } from "./routes/languages.js";
import { storage } from "./routes/storage.js";

const app = new Hono();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use("/api/*", authMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────────────

// 順序重要: jobs より先に storage をマウントすると /:job_id が /download-url を誤捕捉する
app.route("/api/languages", languages);
app.route("/api/jobs", jobs); // GET /:job_id は単一セグメントのみマッチ
app.route("/api", storage); // GET /jobs/:job_id/download-url はここでマッチ

// ─── Error Handlers ───────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// ─── Entry Points ─────────────────────────────────────────────────────────────

// Lambda Function URL handler
export const handler = handle(app);

// ローカル開発サーバー（Lambda 環境では起動しない）
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Backend server running at http://localhost:${info.port}`);
  });
}

export default app;
