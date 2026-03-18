import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { JobDetail, JobStatus } from "../types.js";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const SOURCE_BUCKET = process.env.SOURCE_BUCKET ?? "";
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET ?? "";
const PRESIGN_EXPIRES_IN = 900; // 15 minutes

const STATUS_MESSAGES: Partial<Record<JobStatus, string>> = {
  SUBMITTED: "Translation job is not yet complete",
  IN_PROGRESS: "Translation job is not yet complete",
  FAILED: "Translation job failed",
  STOPPED: "Translation job was stopped",
  STOP_REQUESTED: "Translation job was stopped",
};

export class DownloadUrlError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404 | 502,
  ) {
    super(message);
    this.name = "DownloadUrlError";
  }
}

export const storageService = {
  async getUploadUrl(
    fileName: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    const key = `uploads/${Date.now()}-${fileName}`;
    const command = new PutObjectCommand({
      Bucket: SOURCE_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRES_IN });
    return { uploadUrl, key };
  },

  async getDownloadUrl(job: JobDetail): Promise<{ downloadUrl: string; expiresAt: string }> {
    // ステータスチェック（フィールドアクセスより前）
    if (job.status !== "COMPLETED") {
      const message = STATUS_MESSAGES[job.status] ?? "Job not available";
      throw new DownloadUrlError(message, 404);
    }

    if (!job.outputS3Uri) {
      throw new DownloadUrlError("Internal server error", 502);
    }

    // `s3://{OUTPUT_BUCKET}/` を除いた出力キープレフィックスを取得し、末尾の `/` を保証する
    const outputPrefix = job.outputS3Uri.replace(`s3://${OUTPUT_BUCKET}/`, "").replace(/\/?$/, "/");

    // 入力 S3Uri からベースファイル名を抽出（パスは除く）
    const inputKey = job.inputS3Uri.replace(`s3://${SOURCE_BUCKET}/`, "");
    const baseFilename = inputKey.split("/").pop() ?? inputKey;

    // Amazon Translate 出力パス: {prefix}{targetLang}.{baseFilename}
    const outputKey = `${outputPrefix}${job.targetLanguage}.${baseFilename}`;

    const command = new GetObjectCommand({
      Bucket: OUTPUT_BUCKET,
      Key: outputKey,
    });
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRES_IN });
    const expiresAt = new Date(Date.now() + PRESIGN_EXPIRES_IN * 1000).toISOString();

    return { downloadUrl, expiresAt };
  },
};
