import { Hono } from "hono";
import { DownloadUrlError, storageService } from "../services/storageService.js";
import { translateService } from "../services/translateService.js";

const JOB_NAME_PREFIX = "ppt-translator-";

const storage = new Hono();

// GET /api/upload-url — S3 アップロード用署名付き URL
storage.get("/upload-url", async (c) => {
  const fileName = c.req.query("fileName");
  const contentType = c.req.query("contentType");

  if (!fileName || !contentType) {
    return c.json({ error: "fileName and contentType are required" }, 400);
  }

  const result = await storageService.getUploadUrl(fileName, contentType);
  return c.json(result);
});

// GET /api/jobs/:job_id/download-url — 翻訳済みファイルのダウンロード URL
storage.get("/jobs/:job_id/download-url", async (c) => {
  const jobId = c.req.param("job_id");

  const job = await translateService.describeJob(jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (!job.jobName.startsWith(JOB_NAME_PREFIX)) {
    return c.json({ error: "Job not found" }, 404);
  }

  try {
    const result = await storageService.getDownloadUrl(job);
    return c.json(result);
  } catch (err) {
    if (err instanceof DownloadUrlError) {
      return c.json({ error: err.message }, err.statusCode);
    }
    throw err;
  }
});

export { storage };
