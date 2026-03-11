import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// GET /api/languages - List supported language pairs
app.get("/api/languages", (c) => {
  return c.json({
    languages: [
      { code: "en", name: "English" },
      { code: "ja", name: "Japanese" },
      { code: "zh", name: "Chinese (Simplified)" },
      { code: "ko", name: "Korean" },
      { code: "fr", name: "French" },
      { code: "de", name: "German" },
      { code: "es", name: "Spanish" },
      { code: "pt", name: "Portuguese" },
    ],
  });
});

// GET /api/upload-url - Get presigned S3 URL for file upload
app.get("/api/upload-url", (c) => {
  const fileName = c.req.query("fileName");
  const contentType = c.req.query("contentType");

  if (!fileName || !contentType) {
    return c.json({ error: "fileName and contentType query parameters are required" }, 400);
  }

  // Placeholder: actual implementation will generate a presigned S3 URL
  return c.json({
    uploadUrl: `https://placeholder-bucket.s3.amazonaws.com/${fileName}?presigned=true`,
    key: `uploads/${Date.now()}-${fileName}`,
  });
});

// POST /api/jobs - Create a new translation job
app.post("/api/jobs", async (c) => {
  const body = await c.req.json<{
    sourceKey: string;
    sourceLanguage: string;
    targetLanguage: string;
    fileName: string;
  }>();

  if (!body.sourceKey || !body.sourceLanguage || !body.targetLanguage || !body.fileName) {
    return c.json(
      {
        error: "sourceKey, sourceLanguage, targetLanguage, and fileName are required",
      },
      400,
    );
  }

  // Placeholder: actual implementation will submit an AWS Translate job
  const jobId = `job-${Date.now()}`;
  return c.json(
    {
      jobId,
      status: "SUBMITTED",
      sourceLanguage: body.sourceLanguage,
      targetLanguage: body.targetLanguage,
      fileName: body.fileName,
      createdAt: new Date().toISOString(),
    },
    201,
  );
});

// GET /api/jobs - List translation jobs
app.get("/api/jobs", (c) => {
  // Placeholder: actual implementation will query job records from DynamoDB or similar
  return c.json({
    jobs: [],
    total: 0,
  });
});

// GET /api/jobs/:job_id - Get job status
app.get("/api/jobs/:job_id", (c) => {
  const jobId = c.req.param("job_id");

  // Placeholder: actual implementation will fetch job status from AWS Translate
  return c.json({
    jobId,
    status: "IN_PROGRESS",
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

// GET /api/jobs/:job_id/download-url - Get presigned URL for translated file
app.get("/api/jobs/:job_id/download-url", (c) => {
  const jobId = c.req.param("job_id");

  // Placeholder: actual implementation will generate a presigned S3 download URL
  return c.json({
    downloadUrl: `https://placeholder-bucket.s3.amazonaws.com/translated/${jobId}/output.docx?presigned=true`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
});

const port = parseInt(process.env.PORT ?? "3000", 10);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Backend server running at http://localhost:${info.port}`);
  },
);

export default app;
