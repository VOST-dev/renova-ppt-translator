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
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;
  updatedAt?: string;
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
