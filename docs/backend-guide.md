# バックエンド開発ガイドライン

## 技術スタック

| カテゴリ | ライブラリ | バージョン |
|---------|-----------|----------|
| Webフレームワーク | Hono | 4.x |
| ランタイム | Node.js | 20.x |
| 言語 | TypeScript | 5.x |
| ビルド | tsup | 最新 |
| 開発実行 | tsx | 最新 |
| AWS SDK | @aws-sdk v3 | 3.x |
| Linter / Formatter | Biome | 2.x |

---

## ディレクトリ構成

```
backend/src/
├── routes/     # Hono のルートハンドラー（エンドポイント定義）
├── services/   # ビジネスロジック・AWS SDK 呼び出し
└── index.ts    # エントリポイント（アプリ初期化・サーバー起動）
```

### 各レイヤーの責務

| レイヤー | 責務 | 禁止事項 |
|---------|------|---------|
| `routes/` | リクエスト受信・バリデーション・レスポンス整形 | AWS SDK を直接呼ばない |
| `services/` | ビジネスロジック・外部サービス（AWS）呼び出し | HTTP レスポンスを返さない |
| `index.ts` | アプリ初期化・ミドルウェア設定・サーバー起動 | ビジネスロジックを書かない |

---

## ルート設計

### ルートファイルの分割

`index.ts` にすべてのルートを書くのではなく、機能単位でファイルに分割し、`app.route()` でマウントする。

```ts
// routes/jobs.ts
import { Hono } from "hono";
import { JobService } from "../services/jobService.js";

const jobs = new Hono();
const jobService = new JobService();

jobs.get("/", async (c) => {
  const result = await jobService.listJobs();
  return c.json(result);
});

jobs.post("/", async (c) => {
  const body = await c.req.json<CreateJobRequest>();
  const job = await jobService.createJob(body);
  return c.json(job, 201);
});

jobs.get("/:job_id", async (c) => {
  const jobId = c.req.param("job_id");
  const job = await jobService.getJob(jobId);
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(job);
});

export { jobs };
```

```ts
// index.ts
import { jobs } from "./routes/jobs.js";

app.route("/api/jobs", jobs);
```

### REST API 設計規約

- URL は**小文字スネークケース**で統一（例: `/api/upload-url`）
- リソース名は**複数形**（例: `/api/jobs`, `/api/languages`）
- パスパラメーターは**スネークケース**（例: `/:job_id`）

| 操作 | メソッド | パス例 |
|------|---------|--------|
| 一覧取得 | GET | `/api/jobs` |
| 詳細取得 | GET | `/api/jobs/:job_id` |
| 作成 | POST | `/api/jobs` |
| 更新 | PUT | `/api/jobs/:job_id` |
| 削除 | DELETE | `/api/jobs/:job_id` |

---

## リクエスト・バリデーション

Hono には組み込みの `zValidator` がある。バリデーションは `zod` と組み合わせて使う（導入する場合）。

導入前は**手動バリデーション**を行い、エラー時は 400 を返す。

```ts
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

  // ...
});
```

---

## エラーハンドリング

### グローバルエラーハンドラー

`index.ts` でグローバルなエラーハンドラーを設定し、予期しない例外を 500 として返す。

```ts
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});
```

### エラーレスポンスの形式

エラーレスポンスは統一したフォーマットで返す。

```ts
// 成功
{ "data": { ... } }

// エラー
{ "error": "エラーの説明" }
```

---

## AWS SDK の使い方

### 基本方針

- AWS SDK の呼び出しは必ず `services/` に閉じ込める
- クライアントはモジュールレベルで初期化して再利用する（リクエストごとに生成しない）
- リージョンは環境変数から取得する

### S3 Presigned URL

```ts
// services/storageService.ts
import { S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

export class StorageService {
  async getUploadUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(s3, command, { expiresIn: 900 }); // 15分
  }
}
```

### AWS Translate

```ts
// services/translateService.ts
import { TranslateClient, StartTextTranslationJobCommand } from "@aws-sdk/client-translate";

const translate = new TranslateClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

export class TranslateService {
  async startJob(params: StartJobParams): Promise<string> {
    const command = new StartTextTranslationJobCommand({
      JobName: `job-${Date.now()}`,
      InputDataConfig: {
        S3Uri: `s3://${process.env.S3_BUCKET_NAME}/${params.sourceKey}`,
        ContentType: "text/plain",
      },
      OutputDataConfig: {
        S3Uri: `s3://${process.env.S3_BUCKET_NAME}/translated/`,
      },
      SourceLanguageCode: params.sourceLanguage,
      TargetLanguageCodes: [params.targetLanguage],
      DataAccessRoleArn: process.env.TRANSLATE_ROLE_ARN,
    });

    const response = await translate.send(command);
    return response.JobId ?? "";
  }
}
```

### SSM Parameter Store

設定値の取得には SSM Parameter Store を使う。起動時に一括取得してキャッシュする。

```ts
// services/configService.ts
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

export async function getParameter(name: string, withDecryption = true): Promise<string> {
  const command = new GetParameterCommand({ Name: name, WithDecryption: withDecryption });
  const response = await ssm.send(command);
  return response.Parameter?.Value ?? "";
}
```

---

## 環境変数

| 変数名 | 説明 | 必須 |
|--------|------|------|
| `PORT` | サーバーポート（デフォルト: 3000） | - |
| `AWS_REGION` | AWS リージョン（デフォルト: ap-northeast-1） | - |
| `S3_BUCKET_NAME` | S3 バケット名 | ✅ |
| `TRANSLATE_ROLE_ARN` | AWS Translate 用 IAM ロール ARN | ✅ |

- 環境変数の読み込みは**必ずフォールバック値を持つか、起動時にチェック**する
- シークレット（APIキーなど）は SSM Parameter Store から取得し、`.env` にハードコードしない

---

## TypeScript

### 基本方針

- `strict: true` を維持する
- `any` は使用禁止。型が不明な場合は `unknown` を使い、型ガードで絞り込む
- モジュールは ESM（`import/export`）を使う。`require` は禁止

### 型定義の配置

共有型は `src/types.ts` または各機能のファイルの先頭に定義する。

```ts
// 型定義例
export interface Job {
  jobId: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateJobRequest {
  sourceKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
}
```

### ESM の注意点

tsup でビルドするため、ローカルインポートは **`.js` 拡張子を付ける**（TypeScript の ESM 解決規則）。

```ts
// Good
import { JobService } from "./services/jobService.js";

// NG
import { JobService } from "./services/jobService";
```

---

## コード品質

### Biome

ルートの `biome.json` で設定管理。

```bash
# チェック
pnpm lint

# 自動修正
pnpm lint:fix

# フォーマット
pnpm format
```

### コミット前チェック

Lefthook により、コミット前に lint と typecheck が自動実行される。

---

## 開発フロー

```bash
# 開発サーバー起動（ファイル変更で自動リロード）
pnpm dev:backend

# 型チェック
pnpm typecheck

# ビルド
pnpm build:backend

# 本番起動
node dist/index.js
```

### ローカル開発での AWS 認証

ローカルでは AWS CLI のプロファイルを使う。

```bash
# プロファイルを指定して起動
AWS_PROFILE=your-profile pnpm dev:backend
```
