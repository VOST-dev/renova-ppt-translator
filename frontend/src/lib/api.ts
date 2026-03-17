export interface Job {
  jobId: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string; // ISO 8601
  updatedAt?: string; // ISO 8601
}

// Mock data
const MOCK_JOBS: Job[] = [
  {
    jobId: "job-001",
    status: "COMPLETED",
    sourceLanguage: "en",
    targetLanguage: "ja",
    fileName: "product_manual.docx",
    createdAt: "2026-03-10T09:00:00Z",
    updatedAt: "2026-03-10T09:15:00Z",
  },
  {
    jobId: "job-002",
    status: "IN_PROGRESS",
    sourceLanguage: "ja",
    targetLanguage: "en",
    fileName: "quarterly_report.pdf",
    createdAt: "2026-03-11T08:30:00Z",
  },
  {
    jobId: "job-003",
    status: "SUBMITTED",
    sourceLanguage: "en",
    targetLanguage: "fr",
    fileName: "user_guide.docx",
    createdAt: "2026-03-11T10:00:00Z",
  },
  {
    jobId: "job-004",
    status: "FAILED",
    sourceLanguage: "de",
    targetLanguage: "ja",
    fileName: "technical_spec.pdf",
    createdAt: "2026-03-09T14:00:00Z",
    updatedAt: "2026-03-09T14:05:00Z",
  },
];

export async function fetchJobs(): Promise<{ jobs: Job[]; total: number }> {
  // Mock: simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { jobs: MOCK_JOBS, total: MOCK_JOBS.length };
}

export async function fetchDownloadUrl(jobId: string): Promise<{ downloadUrl: string }> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  // Mock: return a fake presigned URL
  return {
    downloadUrl: `https://example-bucket.s3.amazonaws.com/translations/${jobId}/result.docx?X-Amz-Signature=mock`,
  };
}
