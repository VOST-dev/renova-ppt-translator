# Backend API Design

**Date**: 2026-03-18
**Project**: translator-v2
**Status**: Draft

---

## Overview

Amazon Translate を使った PPTX 翻訳サービスのバックエンド API を実装する。Hono (Node.js + TypeScript) で 6 エンドポイントを提供し、Basic 認証で保護する。データベースは使用せず、ジョブステータスは Amazon Translate API から都度取得する。

---

## Architecture

```
Client
  │  HTTPS + Basic Auth
  ▼
Lambda Function URL
  │
  ▼
Hono App (index.ts)
  ├── basicAuth middleware  ← SSM Parameter Store / 環境変数
  ├── /api/languages        ← languageService → TranslateClient.listLanguages()
  ├── /api/upload-url       ← storageService → S3 PutObject presigned URL
  ├── /api/jobs             ← translateService → StartJob / ListJobs / DescribeJob
  └── /api/jobs/:id/download-url ← storageService → S3 GetObject presigned URL
```

---

## File Structure

```
backend/src/
├── index.ts                    # ミドルウェア・ルートマウント・サーバー起動のみ
├── types.ts                    # 共有型定義
├── middleware/
│   └── auth.ts                 # Hono Basic Auth ミドルウェア
├── routes/
│   ├── languages.ts            # GET /api/languages
│   ├── storage.ts              # GET /api/upload-url, GET /api/jobs/:job_id/download-url
│   └── jobs.ts                 # POST /api/jobs, GET /api/jobs, GET /api/jobs/:job_id
└── services/
    ├── configService.ts        # SSM Parameter Store からの設定取得・キャッシュ
    ├── storageService.ts       # S3 署名付き URL 発行
    ├── translateService.ts     # Amazon Translate ジョブ管理
    └── languageService.ts      # Amazon Translate 言語一覧取得
```

各レイヤーの責務は `backend-guide.md` の規約に従う：
- `routes/`: リクエスト受信・バリデーション・レスポンス整形のみ。AWS SDK を直接呼ばない。
- `services/`: ビジネスロジック・AWS SDK 呼び出しのみ。HTTP レスポンスを返さない。
- `index.ts`: アプリ初期化・ミドルウェア設定・ルートマウント・サーバー起動のみ。

---

## Authentication

### 方式
Hono の `basicAuth` ミドルウェアを使用。全 `/api/*` エンドポイントに適用する。

### 資格情報の取得
Lambda 起動時（モジュール初期化時）に `configService` 経由で SSM Parameter Store から取得し、モジュールスコープにキャッシュする。SSM クライアントは `AWS_REGION` 環境変数で指定されたリージョンを使用する。SSM の取得に失敗した場合（パラメーター未存在・権限エラー等）は例外をスローしてコールドスタートを失敗させる（Lambda は 500 を返す）。エラーは `console.error` でログ出力する。

```
SSM パラメーター名:
  /ppt-translator/basic-auth/username  (String)
  /ppt-translator/basic-auth/password  (SecureString)
```

### ローカル開発フォールバック
環境変数 `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` が設定されている場合は SSM を呼ばずそちらを使用する。

---

## Amazon Translate 出力パス規則

Amazon Translate バッチジョブの出力は以下のパターンで S3 に格納される。

```
s3://{OUTPUT_BUCKET}/{accountId}-TranslateText-{jobId}/{targetLangCode}.{baseFilename}
```

- `{accountId}-TranslateText-{jobId}/` プレフィックスは `DescribeTextTranslationJobCommand` レスポンスの `OutputDataConfig.S3Uri` から取得できる
- `{baseFilename}` は入力ファイルのベース名（パスは除く）。例: `uploads/1710000000000-slides.pptx` → `1710000000000-slides.pptx`
- `{targetLangCode}` が先頭にドット区切りで付与される。例: `en.1710000000000-slides.pptx`

---

## API Endpoints

### GET /api/languages

Amazon Translate がサポートする言語一覧を返す。

**処理**: `TranslateClient.listLanguages()` を呼び出す。

**レスポンス 200**:
```json
{
  "languages": [
    { "code": "en", "name": "English" },
    { "code": "ja", "name": "Japanese" }
  ]
}
```

**エラー**:
- `502`: AWS API エラー

---

### GET /api/upload-url

S3 への直接アップロード用の署名付き PUT URL を発行する。

**クエリパラメーター**:
- `fileName` (必須): アップロードするファイル名
- `contentType` (必須): MIMEタイプ。PPTX 以外も受け付ける（Amazon Translate 側が対応フォーマットを検証する）

**処理**: `PutObjectCommand` + `getSignedUrl()` で有効期限 15 分の URL を生成。S3 キー: `uploads/{timestamp}-{fileName}`

**レスポンス 200**:
```json
{
  "uploadUrl": "https://bucket.s3.amazonaws.com/uploads/...",
  "key": "uploads/1710000000000-slides.pptx"
}
```

**エラー**:
- `400`: `fileName` または `contentType` が未指定
- `502`: AWS API エラー

---

### POST /api/jobs

Amazon Translate のバッチ翻訳ジョブを開始する。

**リクエストボディ**:
```json
{
  "sourceKey": "uploads/1710000000000-slides.pptx",
  "sourceLanguage": "ja",
  "targetLanguage": "en",
  "fileName": "slides.pptx"
}
```

**リクエストボディバリデーション**:
- `sourceKey`, `sourceLanguage`, `targetLanguage`, `fileName` はすべて必須・非空文字列
- `sourceLanguage` / `targetLanguage` の BCP-47 フォーマット検証は行わない（Amazon Translate API が無効コードを `ValidationException` で拒否する）
- `sourceKey` が `uploads/` で始まることのチェックは行わない

**処理**: `StartTextTranslationJobCommand` を呼び出す。

- ジョブ名: `ppt-translator-{timestamp}`
- 入力: `s3://{SOURCE_BUCKET}/{sourceKey}`
- 出力: `s3://{OUTPUT_BUCKET}/`
- `DataAccessRoleArn`: 環境変数 `TRANSLATE_ROLE_ARN` から取得（必須）

**レスポンス 201**:

`POST /api/jobs` のレスポンスは `CreateJobResponse` 型で、`fileName` を含む（Amazon Translate API は `fileName` を管理しないため、`Job` 型とは別に定義する）。`GET /api/jobs` および `GET /api/jobs/:job_id` のレスポンスには `fileName` は含まれない（DB 不使用のため保持不可）。

```json
{
  "jobId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "jobName": "ppt-translator-1710000000000",
  "status": "SUBMITTED",
  "sourceLanguage": "ja",
  "targetLanguage": "en",
  "fileName": "slides.pptx",
  "createdAt": "2026-03-18T00:00:00.000Z"
}
```

**エラー**:
- `400`: 必須フィールド欠如
- `502`: AWS API エラー

---

### GET /api/jobs

このアプリが作成した翻訳ジョブの一覧を返す。

**処理**:
1. `ListTextTranslationJobsCommand` を呼び出す（`Filter.JobName` はプレフィックスではなく完全一致のため使用しない）
2. レスポンスに `NextToken` が含まれる場合は全ページを取得するまで再帰的に呼び出す。最大 10 ページ（500 件）で打ち切る
3. 取得した全ジョブのうち、`JobName` が `ppt-translator-` で始まるものをクライアント側でフィルタリングする

**レスポンス 200**:
```json
{
  "jobs": [
    {
      "jobId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "jobName": "ppt-translator-1710000000000",
      "status": "COMPLETED",
      "sourceLanguage": "ja",
      "targetLanguage": "en",
      "submittedTime": "2026-03-18T00:00:00.000Z",
      "endTime": "2026-03-18T00:05:00.000Z"
    }
  ]
}
```

**エラー**:
- `502`: AWS API エラー

---

### GET /api/jobs/:job_id

特定ジョブのステータスを取得する。

**処理**: `DescribeTextTranslationJobCommand` を呼び出す。ジョブ名が `ppt-translator-` プレフィックスで始まらない場合（他アプリのジョブ）は `404` を返す。

**レスポンス 200**:
```json
{
  "jobId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "jobName": "ppt-translator-1710000000000",
  "status": "IN_PROGRESS",
  "sourceLanguage": "ja",
  "targetLanguage": "en",
  "submittedTime": "2026-03-18T00:00:00.000Z"
}
```

**エラー**:
- `404`: ジョブが見つからない、またはジョブ名が `ppt-translator-` プレフィックスで始まらない
- `502`: AWS API エラー（`ResourceNotFoundException` 以外）

---

### GET /api/jobs/:job_id/download-url

翻訳済みファイルの署名付き GET URL を発行する。

**処理**:
1. `DescribeTextTranslationJobCommand` でジョブ詳細を取得する（`ResourceNotFoundException` → 404）
2. ジョブ名が `ppt-translator-` で始まらない場合は即座に `404` を返す（フィールドアクセスより前）
3. ステータスが `COMPLETED` 以外の場合は即座に `404` を返す（フィールドアクセスより前）。ステータスに応じたエラーメッセージを返す（後述）
4. `OutputDataConfig.S3Uri` が存在しない（null/undefined）場合は `502` を返す。存在する場合、`s3://{OUTPUT_BUCKET}/` を除いた部分を出力キープレフィックスとして抽出する。末尾に `/` がない場合は付与する（例: `s3://bucket/accountId-TranslateText-jobId/` → `accountId-TranslateText-jobId/`）
5. `InputDataConfig.S3Uri` からベースファイル名を抽出する（パスの最後のセグメントのみ。例: `s3://bucket/uploads/file.pptx` → `file.pptx`）
6. 出力 S3 キーを構築する: `{outputKeyPrefix}{targetLangCode}.{baseFilename}`（例: `accountId-TranslateText-jobId/en.file.pptx`）
7. `GetObjectCommand` + `getSignedUrl()` で有効期限 15 分の URL を生成する

**レスポンス 200**:
```json
{
  "downloadUrl": "https://output-bucket.s3.amazonaws.com/...",
  "expiresAt": "2026-03-18T00:15:00.000Z"
}
```

**エラー**:

| 条件 | ステータス | エラーメッセージ |
|---|---|---|
| ジョブが存在しない | `404` | `"Job not found"` |
| `ppt-translator-` プレフィックスでない | `404` | `"Job not found"` |
| ステータスが `SUBMITTED` または `IN_PROGRESS` | `404` | `"Translation job is not yet complete"` |
| ステータスが `FAILED` | `404` | `"Translation job failed"` |
| ステータスが `STOPPED` または `STOP_REQUESTED` | `404` | `"Translation job was stopped"` |
| AWS API エラー（上記以外） | `502` | `"Internal server error"` |

---

## Type Definitions (`src/types.ts`)

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

// POST /api/jobs レスポンス専用（fileName と createdAt を含む）
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
```

---

## Error Handling

`index.ts` にグローバルエラーハンドラーを設定する。

### AWS SDK エラーマッピング

| エラー種別 | HTTP ステータス |
|---|---|
| `ResourceNotFoundException` | 404 |
| `ValidationException` | 400 |
| その他の AWS エラー | 502 |
| 予期しない例外 | 500 |

### レスポンス形式（`backend-guide.md` 準拠）

```json
// エラー
{ "error": "説明メッセージ" }
```

---

## Environment Variables

| 変数名 | 設定元 | 用途 | 必須 |
|---|---|---|---|
| `SOURCE_BUCKET` | CDK Stack Output | アップロード先・翻訳入力バケット名 | ✅ |
| `OUTPUT_BUCKET` | CDK Stack Output | 翻訳結果バケット名 | ✅ |
| `TRANSLATE_ROLE_ARN` | CDK Stack Output | Amazon Translate `DataAccessRoleArn` | ✅ |
| `AWS_REGION` | Lambda 自動付与 | AWS SDK（S3・Translate・SSM）リージョン | - |
| `PORT` | 任意 | ローカル開発サーバーポート（デフォルト: 3000） | - |
| `BASIC_AUTH_USER` | ローカル開発のみ | SSM フォールバック用ユーザー名 | - |
| `BASIC_AUTH_PASS` | ローカル開発のみ | SSM フォールバック用パスワード | - |

---

## Testing

ユニットテストは今回スコープ外。AWS SDK 呼び出しが中心のため、実 AWS 環境での手動動作確認を採用する。TypeScript の strict モードによる型チェックが静的バリデーションの役割を担う。

---

## CDK Changes Required

バックエンド API を動作させるために、`infra/lib/translator-stack.ts` に以下の変更が必要。これらはバックエンド API 実装と同時に対応する。

### 1. `backendRole` に SSM 読み取り権限を追加

```typescript
backendRole.addToPolicy(
  new iam.PolicyStatement({
    actions: ["ssm:GetParameter"],
    resources: [
      `arn:aws:ssm:${this.region}:${this.account}:parameter/ppt-translator/*`,
    ],
  }),
);
```

### 2. `backendRole` に `translate.amazonaws.com` の信頼関係を追加

`StartTextTranslationJobCommand` の `DataAccessRoleArn` に Lambda 実行ロールを使用するため、Amazon Translate がこのロールを引き受けられるよう信頼ポリシーを追加する。

```typescript
backendRole.assumeRolePolicy?.addStatements(
  new iam.PolicyStatement({
    actions: ["sts:AssumeRole"],
    principals: [new iam.ServicePrincipal("translate.amazonaws.com")],
  }),
);
```

### 3. Lambda 環境変数に `TRANSLATE_ROLE_ARN` を追加

```typescript
environment: {
  SOURCE_BUCKET: sourceBucket.bucketName,
  OUTPUT_BUCKET: outputBucket.bucketName,
  TRANSLATE_ROLE_ARN: backendRole.roleArn,  // 追加
  NODE_ENV: "production",
},
```

### 4. Stack Output に `TranslateRoleArn` を追加

```typescript
new cdk.CfnOutput(this, "TranslateRoleArn", {
  value: backendRole.roleArn,
  description: "IAM role ARN used as DataAccessRoleArn for Amazon Translate jobs",
});
```

---

## ADR Updates Required

以下の ADR 記述を更新する：

| 変更箇所 | 旧 | 新 |
|---|---|---|
| 認証方式 | API Gateway Lambda Authorizer | Hono `basicAuth` ミドルウェア |
| 資格情報保存 | AWS SSM Parameter Store (SecureString) | 同上（変更なし） |
| システム構成図 | `API Gateway → Lambda Authorizer → Lambda` | `Lambda Function URL → Hono basicAuth → Lambda` |
