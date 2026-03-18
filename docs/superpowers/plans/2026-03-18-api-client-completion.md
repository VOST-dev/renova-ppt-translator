# API Client Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `frontend/src/lib/api.ts` にバックエンドの全エンドポイントへの呼び出し関数を追加し、ADR-002 の変更をコミットする。

**Architecture:** 全 API 関数を `frontend/src/lib/api.ts` に集約。テストフレームワーク未導入のため、型の正確さは `pnpm typecheck`（`tsc --noEmit`）で検証する。新しい型定義を追加してから関数を実装し、各ステップでコンパイルが通ることを確認する。

**Tech Stack:** TypeScript 5, Vite, React 18, biome (lint)

---

## 変更ファイル

| ファイル | 種別 | 内容 |
|---------|------|------|
| `frontend/src/lib/api.ts` | 変更・追記 | `Job.status` 拡張、型定義 4 種追加、関数 4 種追加 |
| `frontend/.env.example` | 追記 | `VITE_API_BASE_URL` を既存 2 行の後に追加 |
| `frontend/src/vite-env.d.ts` | 確認のみ（変更済み）| `VITE_API_BASE_URL` の型定義（ADR-002 で追加済み）|
| `backend/src/index.ts` | 確認のみ（変更済み・staged）| `ALLOWED_ORIGIN` CORS（ADR-002 で変更済み）|
| `docs/adr/002_direct_lambda_url.md` | 確認のみ（untracked）| ADR ドキュメント |

---

## Task 1: ADR-002 の既存変更をコミット

ADR-002 として既に実装済みの変更をコミットする。`backend/src/index.ts` は staged 済み、その他は unstaged または untracked。

**Files:**
- Confirm: `frontend/src/lib/api.ts` (VITE_API_BASE_URL を使った絶対 URL 呼び出し)
- Confirm: `frontend/src/vite-env.d.ts` (VITE_API_BASE_URL 型定義)
- Confirm: `backend/src/index.ts` (ALLOWED_ORIGIN CORS, already staged)
- Confirm: `docs/adr/002_direct_lambda_url.md` (untracked)

- [ ] **Step 1: 現在の変更内容を確認**

```bash
git diff frontend/src/lib/api.ts frontend/src/vite-env.d.ts
git diff --cached backend/src/index.ts
```

期待: `VITE_API_BASE_URL` の利用が `api.ts` にあり、型定義が `vite-env.d.ts` にある。CORS の `ALLOWED_ORIGIN` が `index.ts` にある。

- [ ] **Step 2: 未ステージのファイルをステージ**

```bash
git add frontend/src/lib/api.ts frontend/src/vite-env.d.ts docs/adr/002_direct_lambda_url.md
```

- [ ] **Step 3: typecheck が通ることを確認**

```bash
pnpm typecheck
```

期待: エラーなし

- [ ] **Step 4: コミット**

```bash
git commit -m "feat(frontend): use VITE_API_BASE_URL for direct Lambda URL calls (ADR-002)"
```

---

## Task 2: `Job.status` の型を拡張

`STOP_REQUESTED` と `STOPPED` を追加する。

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: `Job` インターフェースの `status` を修正**

`frontend/src/lib/api.ts` の `Job` インターフェースを以下に変更：

```typescript
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

- [ ] **Step 2: typecheck を実行**

```bash
pnpm typecheck
```

期待: エラーなし。
⚠️ もし `TranslationStatusBadge.tsx` などで `Job.status` に対して exhaustive switch（`default: never` パターン）を使っている場合、新しいユニオン値が追加されたためコンパイルエラーになる。その場合は該当ファイルの switch に `"STOP_REQUESTED"` と `"STOPPED"` のケースを追加して対処すること。

---

## Task 3: 新規型定義を追加

`api.ts` にセクションコメントとともに型を追加する。

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: 既存の `Job` インターフェースの後に型定義を追記**

`Job` インターフェースの直後（`fetchJobs` 関数の前）に以下を追加：

```typescript
// ─── Job Detail (GET /api/jobs/:id) ───────────────────────────────────────────
// バックエンドの JobDetail（inputS3Uri/outputS3Uri を含むサービス内部型）とは異なる。
// HTTP レスポンスには inputS3Uri/outputS3Uri は含まれないためこちらは JobResponse とする。
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

// ─── Languages (GET /api/languages) ──────────────────────────────────────────
export interface Language {
  code: string;
  name: string;
}

// ─── Upload (GET /api/upload-url) ─────────────────────────────────────────────
export interface UploadUrlResponse {
  uploadUrl: string;
  key: string; // POST /api/jobs の sourceKey に使用
}

// ─── Create Job (POST /api/jobs) ──────────────────────────────────────────────
export interface CreateJobRequest {
  sourceKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
}

export interface CreateJobResponse {
  jobId: string;
  jobName: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
        | "STOP_REQUESTED" | "STOPPED";
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;
}
```

- [ ] **Step 2: typecheck を実行**

```bash
pnpm typecheck
```

期待: エラーなし

---

## Task 4: `fetchUploadUrl` と `fetchLanguages` を追加

クエリパラメータを使う GET 関数 2 つを追加する。

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: `fetchDownloadUrl` の後に 2 関数を追記**

`fetchDownloadUrl` 関数の後に以下を追加：

```typescript
export async function fetchUploadUrl(
  fileName: string,
  contentType: string,
): Promise<UploadUrlResponse> {
  const params = new URLSearchParams({ fileName, contentType });
  return apiFetch(`/api/upload-url?${params}`) as Promise<UploadUrlResponse>;
}

export async function fetchLanguages(): Promise<{ languages: Language[] }> {
  return apiFetch("/api/languages") as Promise<{ languages: Language[] }>;
}
```

- [ ] **Step 2: typecheck を実行**

```bash
pnpm typecheck
```

期待: エラーなし

---

## Task 5: `fetchJob` と `createJob` を追加

残り 2 つの関数を追加する。

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: `fetchLanguages` の後に 2 関数を追記**

```typescript
// ジョブが存在しない場合、apiFetch が Error をスロー
// エラーメッセージ形式: "${status} ${statusText}"（例: "404 Not Found"）
// 呼び出し元は error.message.startsWith("404") で判定すること（statusText は環境依存のため完全一致不可）
export async function fetchJob(jobId: string): Promise<JobResponse> {
  return apiFetch(`/api/jobs/${jobId}`) as Promise<JobResponse>;
}

// レスポンスは HTTP 201
export async function createJob(
  params: CreateJobRequest,
): Promise<CreateJobResponse> {
  return apiFetch("/api/jobs", {
    method: "POST",
    body: JSON.stringify(params),
  }) as Promise<CreateJobResponse>;
}
```

- [ ] **Step 2: typecheck を実行**

```bash
pnpm typecheck
```

期待: エラーなし

- [ ] **Step 3: lint を実行**

```bash
pnpm lint
```

期待: エラーなし（biome による静的解析）

---

## Task 6: `.env.example` に `VITE_API_BASE_URL` を追記

**Files:**
- Modify: `frontend/.env.example`

- [ ] **Step 1: `.env.example` に 1 行追記**

`frontend/.env.example` の現在の内容：
```
VITE_API_USER=your-username
VITE_API_PASS=your-password
```

末尾に以下の 1 行を追加する：
```
VITE_API_BASE_URL=https://your-lambda-id.lambda-url.ap-northeast-1.on.aws
```

- [ ] **Step 2: 変更を確認**

```bash
git diff frontend/.env.example
```

期待: `+VITE_API_BASE_URL=https://...` の 1 行追加のみが表示される。

---

## Task 7: 最終コミット

- [ ] **Step 1: 変更内容を確認**

```bash
git diff frontend/src/lib/api.ts frontend/.env.example
```

期待: 型定義 4 種・関数 4 種の追加と `.env.example` への 1 行追加が表示される。

- [ ] **Step 2: typecheck・lint を最終確認**

```bash
pnpm typecheck && pnpm lint
```

期待: エラーなし

- [ ] **Step 3: ステージしてコミット**

```bash
git add frontend/src/lib/api.ts frontend/.env.example
git commit -m "feat(frontend): add missing API client functions and VITE_API_BASE_URL to .env.example"
```

---

## 実装完了後の手動作業（スコープ外・デプロイ担当者が実施）

以下は Amplify Console での手動作業が必要：

1. **Amplify Console → リライト設定** で `/api/<*>` → Lambda URL のプロキシルールを削除
2. **Amplify Console → 環境変数** に `VITE_API_BASE_URL=<Lambda Function URL>` を追加

> ⚠️ 手順 2 を実施するまで本番環境では `VITE_API_BASE_URL` が undefined のため起動時エラーになる。
