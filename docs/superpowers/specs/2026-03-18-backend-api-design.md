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
Lambda 起動時（モジュール初期化時）に `configService` 経由で SSM Parameter Store から取得し、モジュールスコープにキャッシュする。

```
SSM パラメーター名:
  /ppt-translator/basic-auth/username  (String)
  /ppt-translator/basic-auth/password  (SecureString)
```

### ローカル開発フォールバック
環境変数 `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` が設定されている場合は SSM を呼ばずそちらを使用する。

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

---

### GET /api/upload-url

S3 への直接アップロード用の署名付き PUT URL を発行する。

**クエリパラメーター**:
- `fileName` (必須): アップロードするファイル名
- `contentType` (必須): MIMEタイプ（例: `application/vnd.openxmlformats-officedocument.presentationml.presentation`）

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

**処理**: `StartTextTranslationJobCommand` を呼び出す。

- ジョブ名: `ppt-translator-{timestamp}`
- 入力: `s3://{SOURCE_BUCKET}/{sourceKey}`
- 出力: `s3://{OUTPUT_BUCKET}/`
- `DataAccessRoleArn`: Lambda に付与された IAM ロール ARN（`AWS_LAMBDA_FUNCTION_NAME` から動的に取得、または環境変数 `TRANSLATE_ROLE_ARN` で指定）

**レスポンス 201**:
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

**処理**: `ListTextTranslationJobsCommand` を呼び出し、`Filter.JobName` で `ppt-translator-` プレフィックスのジョブに絞り込む。

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

---

### GET /api/jobs/:job_id

特定ジョブのステータスを取得する。

**処理**: `DescribeTextTranslationJobCommand` を呼び出す。

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
- `404`: ジョブが見つからない

---

### GET /api/jobs/:job_id/download-url

翻訳済みファイルの署名付き GET URL を発行する。

**処理**: Amazon Translate の出力パス規則に従い S3 キーを構築し、`GetObjectCommand` + `getSignedUrl()` で有効期限 15 分の URL を生成する。

出力パス: `{jobId}/{sourceKey}` （Amazon Translate がジョブ ID のプレフィックス配下に出力する）

**レスポンス 200**:
```json
{
  "downloadUrl": "https://output-bucket.s3.amazonaws.com/...",
  "expiresAt": "2026-03-18T00:15:00.000Z"
}
```

**エラー**:
- `404`: ジョブが存在しないまたは未完了

---

## Type Definitions (`src/types.ts`)

```typescript
export type JobStatus = "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "STOP_REQUESTED" | "STOPPED";

export interface Job {
  jobId: string;
  jobName: string;
  status: JobStatus;
  sourceLanguage: string;
  targetLanguage: string;
  submittedTime?: string;
  endTime?: string;
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
| `TRANSLATE_ROLE_ARN` | CDK Stack Output | Amazon Translate 用 IAM ロール ARN | ✅ |
| `AWS_REGION` | Lambda 自動付与 | AWS SDK リージョン | - |
| `PORT` | 任意 | ローカル開発サーバーポート（デフォルト: 3000） | - |
| `BASIC_AUTH_USER` | ローカル開発のみ | SSM フォールバック用ユーザー名 | - |
| `BASIC_AUTH_PASS` | ローカル開発のみ | SSM フォールバック用パスワード | - |

---

## Testing

ユニットテストは今回スコープ外。AWS SDK 呼び出しが中心のため、実 AWS 環境での手動動作確認を採用する。TypeScript の strict モードによる型チェックが静的バリデーションの役割を担う。

---

## ADR Updates Required

以下の ADR 記述を更新する：

| 変更箇所 | 旧 | 新 |
|---|---|---|
| 認証方式 | API Gateway Lambda Authorizer | Hono `basicAuth` ミドルウェア |
| 資格情報保存 | AWS SSM Parameter Store (SecureString) | 同上（変更なし） |
| システム構成図 | API Gateway → Lambda Authorizer → Lambda | Lambda Function URL → Hono basicAuth → Lambda |
