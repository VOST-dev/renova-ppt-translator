# Backend API Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6 エンドポイント + Basic 認証を備えたバックエンド API を Hono (Node.js 22) で実装し、AWS Lambda にデプロイ可能な状態にする。

**Architecture:** `index.ts` はミドルウェア設定とルートマウントのみ。`routes/` は HTTP 処理、`services/` は AWS SDK 呼び出しを担当。SSM から Basic 認証資格情報をコールドスタート時に取得してキャッシュ。ジョブ状態は Amazon Translate API から都度取得（DB 不使用）。

**Tech Stack:** Hono 4.x, @hono/aws-lambda, @aws-sdk v3 (S3・Translate・SSM), AWS CDK 2.x

---

## File Map

| ファイル | 操作 | 内容 |
|---|---|---|
| `infra/lib/translator-stack.ts` | Modify | SSM 権限、Translate 信頼ポリシー、TRANSLATE_ROLE_ARN 環境変数 |
| `backend/src/types.ts` | Create | 共有型定義 |
| `backend/src/services/configService.ts` | Create | SSM Parameter Store からの認証情報取得・キャッシュ |
| `backend/src/middleware/auth.ts` | Create | Hono Basic Auth ミドルウェア |
| `backend/src/services/languageService.ts` | Create | Amazon Translate ListLanguages |
| `backend/src/services/storageService.ts` | Create | S3 署名付き URL 発行（PutObject・GetObject） |
| `backend/src/services/translateService.ts` | Create | Amazon Translate ジョブ管理 |
| `backend/src/routes/languages.ts` | Create | GET /api/languages |
| `backend/src/routes/jobs.ts` | Create | POST /api/jobs, GET /api/jobs, GET /api/jobs/:job_id |
| `backend/src/routes/storage.ts` | Create | GET /api/upload-url, GET /api/jobs/:job_id/download-url |
| `backend/src/index.ts` | Modify | inline ルート削除、ミドルウェア・ルートマウント追加、Lambda handler export |
| `docs/adr/init_project.md` | Modify | 認証方式の記述を Hono basicAuth に更新 |

---

## Task 1: CDK — IAM 権限・環境変数の追加

**Files:**
- Modify: `infra/lib/translator-stack.ts`

- [ ] **Step 1: `translate:ListLanguages` と `ssm:GetParameter` をポリシーに追加**

`infra/lib/translator-stack.ts` の既存の `backendRole.addToPolicy(...)` ブロック（`translate:TranslateDocument` から `resources: ["*"]` までの全体）を、以下の 2 つの `addToPolicy` 呼び出しで**丸ごと置き換える**:

```typescript
    backendRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "translate:TranslateDocument",
          "translate:TranslateText",
          "translate:StartTextTranslationJob",
          "translate:DescribeTextTranslationJob",
          "translate:ListTextTranslationJobs",
          "translate:StopTextTranslationJob",
          "translate:ListLanguages",
        ],
        resources: ["*"],
      }),
    );

    backendRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/ppt-translator/*`,
        ],
      }),
    );
```

- [ ] **Step 2: Translate 信頼ポリシーを追加**

`backendRole` の定義直後（`sourceBucket.grantReadWrite(backendRole)` の前）に追加:

```typescript
    backendRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        principals: [new iam.ServicePrincipal("translate.amazonaws.com")],
      }),
    );
```

- [ ] **Step 3: Lambda 環境変数に `TRANSLATE_ROLE_ARN` を追加**

`backendFunction` の `environment` を以下に更新:

```typescript
      environment: {
        SOURCE_BUCKET: sourceBucket.bucketName,
        OUTPUT_BUCKET: outputBucket.bucketName,
        TRANSLATE_ROLE_ARN: backendRole.roleArn,
        NODE_ENV: "production",
      },
```

- [ ] **Step 4: Stack Output に `TranslateRoleArn` を追加**

既存の Output 群の末尾に追加:

```typescript
    new cdk.CfnOutput(this, "TranslateRoleArn", {
      value: backendRole.roleArn,
      description: "IAM role ARN used as DataAccessRoleArn for Amazon Translate jobs",
    });
```

- [ ] **Step 5: infra typecheck**

```bash
pnpm --filter infra typecheck
```

Expected: エラーなし

- [ ] **Step 6: commit**

```bash
git add infra/lib/translator-stack.ts
git commit -m "feat(infra): add SSM, Translate trust, ListLanguages permissions and TRANSLATE_ROLE_ARN env"
```

---

## Task 2: `@hono/aws-lambda` インストール + 共有型定義

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/types.ts`

- [ ] **Step 1: `@hono/aws-lambda` をインストール**

```bash
cd /Users/nagino/working/vost/renova/translator-v2
pnpm --filter backend add @hono/aws-lambda
```

- [ ] **Step 2: `backend/src/types.ts` を作成**

```typescript
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
```

- [ ] **Step 3: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 4: commit**

```bash
git add backend/package.json backend/pnpm-lock.yaml backend/src/types.ts
git commit -m "feat(backend): add @hono/aws-lambda and shared type definitions"
```

---

## Task 3: `configService.ts` — SSM 資格情報取得

**Files:**
- Create: `backend/src/services/configService.ts`

- [ ] **Step 1: `backend/src/services/configService.ts` を作成**

```typescript
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

async function getParameter(name: string, withDecryption = true): Promise<string> {
  const command = new GetParameterCommand({ Name: name, WithDecryption: withDecryption });
  const response = await ssm.send(command);
  const value = response.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter not found or empty: ${name}`);
  return value;
}

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

let cachedCredentials: BasicAuthCredentials | null = null;

export async function getBasicAuthCredentials(): Promise<BasicAuthCredentials> {
  if (cachedCredentials) return cachedCredentials;

  // ローカル開発フォールバック: 環境変数が設定されていれば SSM を呼ばない
  if (process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS) {
    cachedCredentials = {
      username: process.env.BASIC_AUTH_USER,
      password: process.env.BASIC_AUTH_PASS,
    };
    return cachedCredentials;
  }

  const [username, password] = await Promise.all([
    getParameter("/ppt-translator/basic-auth/username", false),
    getParameter("/ppt-translator/basic-auth/password"),
  ]);

  cachedCredentials = { username, password };
  return cachedCredentials;
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 3: commit**

```bash
git add backend/src/services/configService.ts
git commit -m "feat(backend): add configService — SSM credential fetch with local env fallback"
```

---

## Task 4: `middleware/auth.ts` — Basic 認証ミドルウェア

**Files:**
- Create: `backend/src/middleware/auth.ts`

- [ ] **Step 1: `backend/src/middleware/auth.ts` を作成**

```typescript
import { basicAuth } from "hono/basic-auth";
import type { MiddlewareHandler } from "hono";
import { getBasicAuthCredentials } from "../services/configService.js";

// コールドスタート時に資格情報を取得開始。以降のリクエストでは解決済みの Promise を返す
const credentialsPromise = getBasicAuthCredentials().catch((err) => {
  console.error("Failed to load Basic Auth credentials:", err);
  throw err;
});

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const credentials = await credentialsPromise;
  return basicAuth({ username: credentials.username, password: credentials.password })(c, next);
};
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 3: commit**

```bash
git add backend/src/middleware/auth.ts
git commit -m "feat(backend): add Basic Auth middleware using Hono basicAuth"
```

---

## Task 5: `languageService.ts` — Amazon Translate 言語一覧

**Files:**
- Create: `backend/src/services/languageService.ts`

- [ ] **Step 1: `backend/src/services/languageService.ts` を作成**

```typescript
import { TranslateClient, ListLanguagesCommand } from "@aws-sdk/client-translate";

const client = new TranslateClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

export const languageService = {
  async listLanguages(): Promise<Array<{ code: string; name: string }>> {
    const command = new ListLanguagesCommand({});
    const response = await client.send(command);
    return (response.Languages ?? []).map((lang) => ({
      code: lang.LanguageCode ?? "",
      name: lang.LanguageName ?? "",
    }));
  },
};
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 3: commit**

```bash
git add backend/src/services/languageService.ts
git commit -m "feat(backend): add languageService — Amazon Translate ListLanguages"
```

---

## Task 6: `translateService.ts` — Amazon Translate ジョブ管理

**Files:**
- Create: `backend/src/services/translateService.ts`

- [ ] **Step 1: `backend/src/services/translateService.ts` を作成**

```typescript
import {
  TranslateClient,
  StartTextTranslationJobCommand,
  DescribeTextTranslationJobCommand,
  ListTextTranslationJobsCommand,
  type TextTranslationJobProperties,
} from "@aws-sdk/client-translate";
import type { Job, CreateJobRequest, CreateJobResponse, JobDetail, JobStatus } from "../types.js";

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
        ContentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 3: commit**

```bash
git add backend/src/services/translateService.ts
git commit -m "feat(backend): add translateService — StartJob, ListJobs, DescribeJob"
```

---

## Task 7: `storageService.ts` — S3 署名付き URL

**Files:**
- Create: `backend/src/services/storageService.ts`

- [ ] **Step 1: `backend/src/services/storageService.ts` を作成**

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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

  async getDownloadUrl(
    job: JobDetail,
  ): Promise<{ downloadUrl: string; expiresAt: string }> {
    // ステータスチェック（フィールドアクセスより前）
    if (job.status !== "COMPLETED") {
      const message = STATUS_MESSAGES[job.status] ?? "Job not available";
      throw new DownloadUrlError(message, 404);
    }

    if (!job.outputS3Uri) {
      throw new DownloadUrlError("Internal server error", 502);
    }

    // `s3://{OUTPUT_BUCKET}/` を除いた出力キープレフィックスを取得し、末尾の `/` を保証する
    const outputPrefix = job.outputS3Uri
      .replace(`s3://${OUTPUT_BUCKET}/`, "")
      .replace(/\/?$/, "/");

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
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 3: commit**

```bash
git add backend/src/services/storageService.ts
git commit -m "feat(backend): add storageService — S3 presigned upload/download URLs"
```

---

## Task 8: `routes/languages.ts`

**Files:**
- Create: `backend/src/routes/languages.ts`

- [ ] **Step 1: `backend/src/routes/languages.ts` を作成**

```typescript
import { Hono } from "hono";
import { languageService } from "../services/languageService.js";

const languages = new Hono();

languages.get("/", async (c) => {
  const result = await languageService.listLanguages();
  return c.json({ languages: result });
});

export { languages };
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 3: commit**

```bash
git add backend/src/routes/languages.ts
git commit -m "feat(backend): add GET /api/languages route"
```

---

## Task 9: `routes/jobs.ts`

**Files:**
- Create: `backend/src/routes/jobs.ts`

- [ ] **Step 1: `backend/src/routes/jobs.ts` を作成**

```typescript
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

  const result = await translateService.startJob({ sourceKey, sourceLanguage, targetLanguage, fileName });
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
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 3: commit**

```bash
git add backend/src/routes/jobs.ts
git commit -m "feat(backend): add POST/GET /api/jobs routes"
```

---

## Task 10: `routes/storage.ts`

**Files:**
- Create: `backend/src/routes/storage.ts`

- [ ] **Step 1: `backend/src/routes/storage.ts` を作成**

```typescript
import { Hono } from "hono";
import { storageService, DownloadUrlError } from "../services/storageService.js";
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
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 3: commit**

```bash
git add backend/src/routes/storage.ts
git commit -m "feat(backend): add GET /api/upload-url and /api/jobs/:id/download-url routes"
```

---

## Task 11: `index.ts` リファクタリング

inline ルートを削除し、ミドルウェア・ルートマウント・Lambda handler export を追加する。

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: `backend/src/index.ts` を以下で全置換**

```typescript
import { handle } from "@hono/aws-lambda";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth.js";
import { languages } from "./routes/languages.js";
import { jobs } from "./routes/jobs.js";
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
app.route("/api/jobs", jobs);    // GET /:job_id は単一セグメントのみマッチ
app.route("/api", storage);      // GET /jobs/:job_id/download-url はここでマッチ

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
  serve(
    { fetch: app.fetch, port },
    (info) => {
      console.log(`Backend server running at http://localhost:${info.port}`);
    },
  );
}

export default app;
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter backend typecheck
```

Expected: エラーなし

- [ ] **Step 3: lint**

```bash
pnpm --filter backend exec biome check src/
```

Expected: エラーなし（警告があれば `pnpm lint:fix` で修正）

- [ ] **Step 4: ローカル動作確認**

```bash
# 別ターミナルで起動
BASIC_AUTH_USER=admin BASIC_AUTH_PASS=secret SOURCE_BUCKET=test OUTPUT_BUCKET=test TRANSLATE_ROLE_ARN=arn:aws:iam::123:role/test pnpm dev:backend
```

別ターミナルで確認:

```bash
curl -u admin:secret http://localhost:3000/api/languages
```

Expected: `{"languages":[...]}` が返る（`ListLanguages` API への接続がなければ 502 が返るが、起動自体は成功すること）

```bash
curl http://localhost:3000/api/jobs
```

Expected: `401 Unauthorized`（Basic 認証なしのアクセスが拒否される）

- [ ] **Step 5: commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): wire up routes, auth middleware, Lambda handler export"
```

---

## Task 12: ADR 更新

**Files:**
- Modify: `docs/adr/init_project.md`

- [ ] **Step 1: 認証方式の記述を更新**

`docs/adr/init_project.md` の以下の箇所を更新:

構成図内の Lambda Authorizer の記述を削除:

```
# 変更前
│                          ├─ Lambda Authorizer (Basic 認証)
│                          │
│                          └─ [Lambda (Node.js)]

# 変更後
│                          └─ [Lambda (Node.js)]
│                             └── Hono basicAuth middleware
```

認証方式セクションを更新:

```markdown
## 認証方式

- **方式**: HTTP Basic 認証
- **実装**: Hono `basicAuth` ミドルウェア（Lambda Authorizer は不使用）
- **資格情報保存**: AWS SSM Parameter Store (SecureString)
- **制約**: ユーザー単位の分離なし。認証はアクセス制御のみを目的とする
```

- [ ] **Step 2: commit**

```bash
git add docs/adr/init_project.md
git commit -m "docs(adr): update auth from Lambda Authorizer to Hono basicAuth middleware"
```

---

## 完了チェックリスト

- [ ] `pnpm --filter infra typecheck` パス
- [ ] `pnpm --filter backend typecheck` パス
- [ ] `pnpm lint` パス（全パッケージ）
- [ ] ローカルで Basic 認証の動作確認済み（`401` が返ること）
- [ ] 全 12 タスクのコミット済み
