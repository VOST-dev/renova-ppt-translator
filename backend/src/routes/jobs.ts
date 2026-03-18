import { Hono } from "hono";
import { translateService } from "../services/translateService.js";
import type { CreateJobRequest } from "../types.js";

const JOB_NAME_PREFIX = "ppt-translator-";

const jobs = new Hono();

// POST /api/jobs — 翻訳ジョブ開始
jobs.post("/", async (c) => {
  const body = await c.req.json<CreateJobRequest>().catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { sourceKey, sourceLanguage, targetLanguage, fileName } = body;

  if (!sourceKey || !sourceLanguage || !targetLanguage || !fileName) {
    return c.json(
      { error: "sourceKey, sourceLanguage, targetLanguage, fileName are required" },
      400,
    );
  }

  const result = await translateService.startJob({
    sourceKey,
    sourceLanguage,
    targetLanguage,
    fileName,
  });
  return c.json(result, 201);
});

// GET /api/jobs — ジョブ一覧
jobs.get("/", async (c) => {
  const result = await translateService.listJobs();
  return c.json({ jobs: result });
});

// GET /api/jobs/:job_id — ジョブ詳細
jobs.get("/:job_id", async (c) => {
  const jobId = c.req.param("job_id");
  const job = await translateService.describeJob(jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (!job.jobName.startsWith(JOB_NAME_PREFIX)) {
    return c.json({ error: "Job not found" }, 404);
  }

  const { inputS3Uri: _inputS3Uri, outputS3Uri: _outputS3Uri, ...jobData } = job;
  return c.json(jobData);
});

export { jobs };
