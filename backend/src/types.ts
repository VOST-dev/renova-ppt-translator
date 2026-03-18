export type JobStatus =
  | "SUBMITTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "STOP_REQUESTED"
  | "STOPPED";

export interface Job {
  jobId: string;
  jobName: string;
  status: JobStatus;
  sourceLanguage: string;
  targetLanguage: string;
  submittedTime?: string;
  endTime?: string;
}

// POST /api/jobs レスポンス専用（fileName・createdAt を含む）
export interface CreateJobResponse {
  jobId: string;
  jobName: string;
  status: JobStatus;
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;
}

export interface CreateJobRequest {
  sourceKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
}

// translateService.describeJob の返却型（storageService が使用）
export interface JobDetail extends Job {
  inputS3Uri: string;
  outputS3Uri?: string;
}
