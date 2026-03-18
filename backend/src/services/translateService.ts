import {
  DescribeTextTranslationJobCommand,
  ListTextTranslationJobsCommand,
  StartTextTranslationJobCommand,
  type TextTranslationJobProperties,
  TranslateClient,
} from "@aws-sdk/client-translate";
import type { CreateJobRequest, CreateJobResponse, Job, JobDetail, JobStatus } from "../types.js";

const client = new TranslateClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

const SOURCE_BUCKET = process.env.SOURCE_BUCKET ?? "";
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET ?? "";
const TRANSLATE_ROLE_ARN = process.env.TRANSLATE_ROLE_ARN ?? "";
const JOB_NAME_PREFIX = "ppt-translator-";
const MAX_LIST_PAGES = 10;

function mapProperties(props: TextTranslationJobProperties): Job {
  return {
    jobId: props.JobId ?? "",
    jobName: props.JobName ?? "",
    status: (props.JobStatus as JobStatus) ?? "SUBMITTED",
    sourceLanguage: props.SourceLanguageCode ?? "",
    targetLanguage: props.TargetLanguageCodes?.[0] ?? "",
    submittedTime: props.SubmittedTime?.toISOString(),
    endTime: props.EndTime?.toISOString(),
  };
}

export const translateService = {
  async startJob(req: CreateJobRequest): Promise<CreateJobResponse> {
    const jobName = `${JOB_NAME_PREFIX}${Date.now()}`;
    const command = new StartTextTranslationJobCommand({
      JobName: jobName,
      InputDataConfig: {
        S3Uri: `s3://${SOURCE_BUCKET}/${req.sourceKey}`,
        ContentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
      OutputDataConfig: {
        S3Uri: `s3://${OUTPUT_BUCKET}/`,
      },
      DataAccessRoleArn: TRANSLATE_ROLE_ARN,
      SourceLanguageCode: req.sourceLanguage,
      TargetLanguageCodes: [req.targetLanguage],
    });

    const response = await client.send(command);

    return {
      jobId: response.JobId ?? "",
      jobName,
      status: (response.JobStatus as JobStatus) ?? "SUBMITTED",
      sourceLanguage: req.sourceLanguage,
      targetLanguage: req.targetLanguage,
      fileName: req.fileName,
      createdAt: new Date().toISOString(),
    };
  },

  async listJobs(): Promise<Job[]> {
    const allJobs: Job[] = [];
    let nextToken: string | undefined;
    let pageCount = 0;

    do {
      const command = new ListTextTranslationJobsCommand({ NextToken: nextToken });
      const response = await client.send(command);

      const filtered = (response.TextTranslationJobPropertiesList ?? [])
        .filter((job) => job.JobName?.startsWith(JOB_NAME_PREFIX))
        .map(mapProperties);

      allJobs.push(...filtered);
      nextToken = response.NextToken;
      pageCount++;
    } while (nextToken && pageCount < MAX_LIST_PAGES);

    return allJobs;
  },

  async describeJob(jobId: string): Promise<JobDetail | null> {
    try {
      const command = new DescribeTextTranslationJobCommand({ JobId: jobId });
      const response = await client.send(command);
      const props = response.TextTranslationJobProperties;

      if (!props) return null;

      return {
        ...mapProperties(props),
        inputS3Uri: props.InputDataConfig?.S3Uri ?? "",
        outputS3Uri: props.OutputDataConfig?.S3Uri,
      };
    } catch (err: unknown) {
      // ジョブ未存在の場合は null を返す（routes 側で 404 に変換する）
      if (
        typeof err === "object" &&
        err !== null &&
        "name" in err &&
        (err as { name: string }).name === "ResourceNotFoundException"
      ) {
        return null;
      }
      throw err;
    }
  },
};
