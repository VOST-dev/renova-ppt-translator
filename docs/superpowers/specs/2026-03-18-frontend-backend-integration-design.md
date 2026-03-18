# フロントエンド・バックエンド繋ぎこみ設計

**Date**: 2026-03-18
**Status**: Approved
**Scope**: フロントエンド（AWS Amplify）とバックエンド API（Lambda Function URL）の接続

---

## 概要

React フロントエンドを AWS Amplify にホスティングし、Hono バックエンド（Lambda Function URL）と接続する。Amplify の Rewrite 機能をサーバーサイドプロキシとして使い、フロントエンドは相対パス `/api/*` でバックエンドを呼び出す。

---

## アーキテクチャ & データフロー

```
[ ブラウザ ]
    │  fetch('/api/jobs', { headers: { Authorization: 'Basic xxx' } })
    │  ※認証情報はビルド時に VITE_API_USER/PASS から生成
    ▼
[ Amplify Hosting (CloudFront) ]
    │  Rewrite ルール: /api/<*> → {LAMBDA_URL}/api/<*>  (200 = サーバーサイドプロキシ)
    │  ※Amplify Basic Auth でアプリ全体も保護（別レイヤー）
    ▼
[ Lambda Function URL ]
    │  Hono basicAuth ミドルウェアで認証
    │  CORS: Amplify ドメインのみ許可
    ▼
[ Hono ルーター → Services → AWS Translate / S3 ]
```

### 認証の二重保護

| レイヤー | 仕組み | 目的 |
|---|---|---|
| Amplify Basic Auth | CloudFront レベルでアプリ全体を保護 | 不正アクセス防止（ユーザー向け） |
| Lambda Basic Auth | Hono basicAuth ミドルウェア | Lambda URL が漏洩した場合の防御 |

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `frontend/src/lib/api.ts` | モック削除 → 実 fetch + Authorization ヘッダー |
| `frontend/.env.example` | 環境変数のサンプルファイル追加 |
| `infra/lib/translator-stack.ts` | Lambda CORS 許可オリジンを環境変数から設定 |
| `amplify.yml` | Amplify ビルド設定ファイル追加 |

**変更しないファイル:**
- `vite.config.ts`（dev プロキシ設定はそのまま動く）
- バックエンドのルーター・認証ロジック

---

## セクション詳細

### 1. フロントエンド: `frontend/src/lib/api.ts`

モックデータを削除し、実際の fetch に置き換える。

```ts
const authHeader = `Basic ${btoa(`${import.meta.env.VITE_API_USER}:${import.meta.env.VITE_API_PASS}`)}`;

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchJobs(): Promise<Job[]> {
  return apiFetch('/api/jobs');
}

export async function fetchDownloadUrl(jobId: string): Promise<{ url: string }> {
  return apiFetch(`/api/jobs/${jobId}/download-url`);
}
```

**開発時の環境変数:**
- `frontend/.env.local`（gitignore 済み）に `VITE_API_USER` / `VITE_API_PASS` を設定
- `frontend/.env.example` をサンプルとして追加

### 2. バックエンド CORS: `infra/lib/translator-stack.ts`

Lambda の環境変数に `ALLOWED_ORIGIN` を追加。値は CDK デプロイ時の環境変数から取得。

```ts
environment: {
  SOURCE_BUCKET: sourceBucket.bucketName,
  OUTPUT_BUCKET: outputBucket.bucketName,
  TRANSLATE_ROLE_ARN: translateRole.roleArn,
  NODE_ENV: 'production',
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
},
```

`backend/src/index.ts` の CORS 設定:

```ts
app.use('*', cors({
  origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST'],
}));
```

**デプロイコマンド例:**

```bash
ALLOWED_ORIGIN=https://your-app.amplifyapp.com pnpm deploy
```

### 3. Amplify 設定（コンソール手動設定）

**① Rewrite ルール** (Hosting → Rewrites and redirects)

| Source | Target | Type |
|---|---|---|
| `/api/<*>` | `{Lambda Function URL}/api/<*>` | `200 (Rewrite)` |
| `</^[^.]+$\|\.(?!(css\|gif\|ico\|jpg\|js\|png\|txt\|svg\|woff\|ttf\|map\|json)$)([^.]+$)/>` | `/index.html` | `200 (Rewrite)` |

**② 環境変数** (Environment variables)

| 変数名 | 値 |
|---|---|
| `VITE_API_USER` | Basic Auth のユーザー名 |
| `VITE_API_PASS` | Basic Auth のパスワード |

**③ Amplify Basic Auth** (Access control)

アプリ全体を Basic Auth で保護する。バックエンドと同じ認証情報を推奨（管理簡略化のため）。

### 4. Amplify ビルド設定: `amplify.yml`

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend
        - npm install -g pnpm
        - pnpm install
    build:
      commands:
        - pnpm build
  artifacts:
    baseDirectory: frontend/dist
    files:
      - '**/*'
  cache:
    paths:
      - frontend/node_modules/**/*
```

---

## 環境変数まとめ

| 変数名 | 設定場所 | 用途 |
|---|---|---|
| `VITE_API_USER` | Amplify 環境変数 / `.env.local` | フロントエンド: Basic Auth ユーザー名 |
| `VITE_API_PASS` | Amplify 環境変数 / `.env.local` | フロントエンド: Basic Auth パスワード |
| `ALLOWED_ORIGIN` | CDK デプロイ時の環境変数 | バックエンド: CORS 許可オリジン |

---

## 開発フロー

```
開発時: ブラウザ → Vite Dev Server(:5173) → proxy → Hono(:3000)
本番時: ブラウザ → Amplify(CloudFront) → Rewrite proxy → Lambda Function URL
```

両環境ともフロントエンドのコードは `/api/*` の相対パスを使うため、差異なし。
