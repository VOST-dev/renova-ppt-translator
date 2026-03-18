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

また `frontend/.env.example` に `VITE_API_BASE_URL` の記載がない（既存の 2 行に 1 行追記する）。

## 既知の型不整合（本タスクで解消）

現在の `api.ts` の `Job` インターフェースはバックエンドの型と乖離している：

| フィールド | 現フロントエンド `Job` | バックエンド `Job` | 対応 |
|-----------|---------------------|-----------------|------|
| `fileName` | ✅ あり | ❌ なし | 本タスクで削除しない（既存利用箇所を守るため維持） |
| `createdAt` | ✅ あり | ❌ なし | 同上 |
| `jobName` | ❌ なし | ✅ あり | 本タスクで追加しない（`fetchJobs` の既存動作を変えない） |
| `status` の値 | 4 種のみ | 6 種 | `STOP_REQUESTED`, `STOPPED` を追加する |

`GET /api/jobs/:id` は `JobDetail`（inputS3Uri/outputS3Uri を除いた `Job`）を返すため、`fetchJob()` の返却型には新たに `JobDetail` 型を定義する。

## 設計

### アーキテクチャ方針

- 全 API 関数を `frontend/src/lib/api.ts` に集約する（Approach A）
- バックエンドの型定義（`backend/src/types.ts`）と整合性を保つ
- セクションコメントで型定義・関数を整理する

### 型定義の変更・追加

#### 既存 `Job` の変更

```typescript
// status ユニオンに STOP_REQUESTED / STOPPED を追加
export interface Job {
  jobId: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
        | "STOP_REQUESTED" | "STOPPED";
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;
  updatedAt?: string;
}
```

#### 新規追加

```typescript
// GET /api/jobs/:id レスポンス（バックエンド Job 型に対応）
// ※ バックエンドに JobDetail という型が存在するが、あちらは inputS3Uri/outputS3Uri を含む
//   サービス内部型であり、HTTP レスポンスには含まれない。フロントエンド側の名称は
//   衝突を避けるため JobResponse とする。
export interface JobResponse {
  jobId: string;
  jobName: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
        | "STOP_REQUESTED" | "STOPPED";
  sourceLanguage: string;
  targetLanguage: string;
  submittedTime?: string;
  endTime?: string;
}

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
  jobName: string;
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

// POST /api/jobs  (レスポンス HTTP 201)
export async function createJob(
  params: CreateJobRequest,
): Promise<CreateJobResponse>

// GET /api/jobs/:id
// ジョブが存在しない場合は apiFetch が Error をスローする（メッセージ形式: "${status} ${statusText}"）
// 呼び出し元は error.message.startsWith("404") で判定すること（statusText は環境依存のため完全一致不可）
export async function fetchJob(jobId: string): Promise<JobResponse>

// GET /api/languages
export async function fetchLanguages(): Promise<{ languages: Language[] }>
```

### `.env.example` 更新（既存 2 行に 1 行追記）

```
VITE_API_USER=your-username
VITE_API_PASS=your-password
VITE_API_BASE_URL=https://your-lambda-id.lambda-url.ap-northeast-1.on.aws
```

## データフロー（ファイルアップロード → 翻訳ジョブ作成）

```
1. fetchUploadUrl(fileName, contentType)
   → GET /api/upload-url?fileName=...&contentType=...
   → { uploadUrl, key }

2. fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": contentType } })
   → S3 に直接アップロード（認証不要・S3 署名付き URL）
   ※ apiFetch ではなく生の fetch() を使うこと。apiFetch は Authorization ヘッダーを
     付与するため、S3 署名付き URL に送ると 403 になる。
   ※ Content-Type は手順 1 で渡した contentType と必ず一致させること
     （署名付き URL は ContentType に紐づいているため不一致で 403 になる）

3. createJob({ sourceKey: key, sourceLanguage, targetLanguage, fileName })
   → POST /api/jobs  → HTTP 201
   → { jobId, jobName, status, ... }

4. fetchJobs() でポーリング
   → GET /api/jobs
```

## 変更ファイル一覧

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `frontend/src/lib/api.ts` | 変更・追記 | `Job.status` 拡張、`JobResponse` 等の型定義 4 種追加、関数 4 種追加 |
| `frontend/.env.example` | 追記 | `VITE_API_BASE_URL` を既存 2 行の後に追加 |

## スコープ外

- Amplify Console でのリライトルール削除（手動作業・デプロイ担当者が実施）
- Amplify Console への `VITE_API_BASE_URL` 環境変数設定（手動作業・本タスク完了後に必須）
  ※ この設定が完了するまで本番環境では `VITE_API_BASE_URL` が undefined となり起動時エラーになる
- フロントエンド UI コンポーネントの実装（別タスク）
