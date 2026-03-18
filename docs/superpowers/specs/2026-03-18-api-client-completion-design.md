# API クライアント完成設計書

- **日付**: 2026-03-18
- **関連**: ADR-002（Lambda URL 直接呼び出し）

## 概要

ADR-002 で決定した Lambda URL 直接呼び出し構成を踏まえ、フロントエンドの `api.ts` に未実装の API 呼び出し関数を追加する。あわせて `.env.example` に `VITE_API_BASE_URL` を追記する。

## 現状

### 実装済み（ADR-002 対応として既に変更済み・未コミット）

| ファイル | 変更内容 |
|---------|---------|
| `frontend/src/lib/api.ts` | `VITE_API_BASE_URL` を使った絶対 URL 呼び出しに変更 |
| `frontend/src/vite-env.d.ts` | `VITE_API_BASE_URL` の型定義を追加 |
| `backend/src/index.ts` | `ALLOWED_ORIGIN` を使った CORS 設定（ステージ済み）|

### 未実装（本タスクのスコープ）

`frontend/src/lib/api.ts` に以下のバックエンドエンドポイントへの呼び出し関数がない：

| エンドポイント | 用途 |
|-------------|------|
| `GET /api/upload-url` | S3 署名付きアップロード URL 取得 |
| `POST /api/jobs` | 翻訳ジョブ作成 |
| `GET /api/jobs/:id` | ジョブ詳細取得 |
| `GET /api/languages` | 翻訳対応言語一覧取得 |

また `frontend/.env.example` に `VITE_API_BASE_URL` の記載がない。

## 設計

### アーキテクチャ方針

- 全 API 関数を `frontend/src/lib/api.ts` に集約する（Approach A）
- バックエンドの型定義（`backend/src/types.ts`）と整合性を保つ
- セクションコメントで型定義・関数を整理する

### 追加する型定義

```typescript
export interface Language {
  code: string;
  name: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  key: string;  // POST /api/jobs の sourceKey に使用
}

export interface CreateJobRequest {
  sourceKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
}

export interface CreateJobResponse {
  jobId: string;
  status: string;
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;
}
```

### 追加する関数

```typescript
// GET /api/upload-url?fileName=&contentType=
export async function fetchUploadUrl(
  fileName: string,
  contentType: string,
): Promise<UploadUrlResponse>

// POST /api/jobs
export async function createJob(
  params: CreateJobRequest,
): Promise<CreateJobResponse>

// GET /api/jobs/:id
export async function fetchJob(jobId: string): Promise<Job>

// GET /api/languages
export async function fetchLanguages(): Promise<{ languages: Language[] }>
```

### `.env.example` 更新

```
VITE_API_USER=your-username
VITE_API_PASS=your-password
VITE_API_BASE_URL=https://your-lambda-id.lambda-url.ap-northeast-1.on.aws
```

## データフロー（ファイルアップロード → 翻訳ジョブ作成）

```
1. fetchUploadUrl(fileName, contentType)
   → GET /api/upload-url
   → { uploadUrl, key }

2. fetch(uploadUrl, { method: "PUT", body: file })
   → S3 に直接アップロード（認証不要・S3 署名付き URL）

3. createJob({ sourceKey: key, sourceLanguage, targetLanguage, fileName })
   → POST /api/jobs
   → { jobId, status, ... }

4. fetchJobs() でポーリング
   → GET /api/jobs
```

## 変更ファイル一覧

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `frontend/src/lib/api.ts` | 追記 | 型定義 4 種・関数 4 種を追加 |
| `frontend/.env.example` | 追記 | `VITE_API_BASE_URL` を追加 |

## スコープ外

- Amplify Console でのリライトルール削除（手動作業）
- Amplify Console への `VITE_API_BASE_URL` 環境変数設定（手動作業）
- フロントエンド UI コンポーネントの実装（別タスク）
