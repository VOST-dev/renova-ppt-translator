if (
  !import.meta.env.VITE_API_USER ||
  !import.meta.env.VITE_API_PASS ||
  !import.meta.env.VITE_API_BASE_URL
) {
  throw new Error("VITE_API_USER, VITE_API_PASS, and VITE_API_BASE_URL must be set");
}

const authHeader = `Basic ${btoa(`${import.meta.env.VITE_API_USER}:${import.meta.env.VITE_API_PASS}`)}`;
const baseUrl = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface Job {
  jobId: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "STOP_REQUESTED" | "STOPPED";
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;
  updatedAt?: string;
}

// ─── Job Detail (GET /api/jobs/:id) ───────────────────────────────────────────
// バックエンドの JobDetail（inputS3Uri/outputS3Uri を含むサービス内部型）とは異なる。
// HTTP レスポンスには inputS3Uri/outputS3Uri は含まれないためこちらは JobResponse とする。
export interface JobResponse {
  jobId: string;
  jobName: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "STOP_REQUESTED" | "STOPPED";
  sourceLanguage: string;
  targetLanguage: string;
  submittedTime?: string;
  endTime?: string;
}

// ─── Languages (GET /api/languages) ──────────────────────────────────────────
export interface Language {
  code: string;
  name: string;
}

// ─── Upload (GET /api/upload-url) ─────────────────────────────────────────────
export interface UploadUrlResponse {
  uploadUrl: string;
  key: string; // POST /api/jobs の sourceKey に使用
}

// ─── Create Job (POST /api/jobs) ──────────────────────────────────────────────
export interface CreateJobRequest {
  sourceKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
}

export interface CreateJobResponse {
  jobId: string;
  jobName: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "STOP_REQUESTED" | "STOPPED";
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;
}

export async function fetchJobs(): Promise<{ jobs: Job[] }> {
  return apiFetch("/api/jobs") as Promise<{ jobs: Job[] }>;
}

export async function fetchDownloadUrl(
  jobId: string,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  return apiFetch(`/api/jobs/${jobId}/download-url`) as Promise<{
    downloadUrl: string;
    expiresAt: string;
  }>;
}

export async function fetchUploadUrl(
  fileName: string,
  contentType: string,
): Promise<UploadUrlResponse> {
  const params = new URLSearchParams({ fileName, contentType });
  return apiFetch(`/api/upload-url?${params}`) as Promise<UploadUrlResponse>;
}

export async function fetchLanguages(): Promise<{ languages: Language[] }> {
  return apiFetch("/api/languages") as Promise<{ languages: Language[] }>;
}

// ジョブが存在しない場合、apiFetch が Error をスロー
// エラーメッセージ形式: "${status} ${statusText}"（例: "404 Not Found"）
// 呼び出し元は error.message.startsWith("404") で判定すること（statusText は環境依存のため完全一致不可）
export async function fetchJob(jobId: string): Promise<JobResponse> {
  return apiFetch(`/api/jobs/${jobId}`) as Promise<JobResponse>;
}

// レスポンスは HTTP 201
export async function createJob(params: CreateJobRequest): Promise<CreateJobResponse> {
  return apiFetch("/api/jobs", {
    method: "POST",
    body: JSON.stringify(params),
  }) as Promise<CreateJobResponse>;
}
