# Frontend-Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** フロントエンドのモック API クライアントを実 fetch に置き換え、AWS Amplify ホスティングとバックエンド Lambda Function URL を接続する。

**Architecture:** Amplify Hosting の Rewrite ルールをサーバーサイドプロキシとして使い、フロントエンドは相対パス `/api/*` でバックエンドを呼び出す。Basic Auth 認証情報はビルド時に環境変数から埋め込む。Lambda Function URL の CORS は CDK レベルと Hono ミドルウェアの両方で Amplify ドメインに絞り込む。

**Tech Stack:** React + Vite + TanStack Query / Hono on Lambda / AWS CDK v2 / AWS Amplify Hosting

**Spec:** `docs/superpowers/specs/2026-03-18-frontend-backend-integration-design.md`

---

## File Map

| ファイル | 操作 | 内容 |
|---|---|---|
| `frontend/src/lib/api.ts` | 修正 | モック削除・実 fetch・Authorization ヘッダー・型修正 |
| `frontend/.env.example` | 新規 | 必要な環境変数のサンプル |
| `backend/src/index.ts` | 修正 | CORS origin を env var から読み込み |
| `infra/lib/translator-stack.ts` | 修正 | `ALLOWED_ORIGIN` 追加・Function URL CORS 絞り込み |
| `amplify.yml` | 新規 | Amplify ビルド設定 |

---

## Task 1: フロントエンド API クライアントの実装

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/.env.example`

### なぜこの順番か

`api.ts` の型変更（`fetchJobs` の返り値から `total` を削除、`fetchDownloadUrl` の返り値に `expiresAt` 追加）により既存コードが壊れないことを typecheck で確認する。

- `fetchJobs`: `TranslationListPage.tsx` は `data.jobs` のみ参照しており `total` は使っていないため安全
- `fetchDownloadUrl`: `useDownloadJob.ts` は `{ downloadUrl }` のみ destructure しており、`expiresAt` が増えても型互換は保たれる

- [ ] **Step 1: `.env.example` を作成する**

```
VITE_API_USER=your-username
VITE_API_PASS=your-password
```

ファイル: `frontend/.env.example`

- [ ] **Step 2: `frontend/.env.local` をローカル開発用に作成する**

`.env.local` はルートの `.gitignore` で除外済みなので実際の認証情報を入れてよい。

```
VITE_API_USER=<開発用ユーザー名>
VITE_API_PASS=<開発用パスワード>
```

> `.env.local` に設定する認証情報は、バックエンドの SSM `/ppt-translator/basic-auth-username` と `/ppt-translator/basic-auth-password` に登録済みの値と一致させること。ローカルで Hono が起動していない場合は Vite プロキシ先が動いていないためエラーになるが、型チェックは通る。

- [ ] **Step 3: `api.ts` をモックから実 fetch に置き換える**

`frontend/src/lib/api.ts` を以下で完全に上書きする:

```ts
if (!import.meta.env.VITE_API_USER || !import.meta.env.VITE_API_PASS) {
  throw new Error("VITE_API_USER and VITE_API_PASS must be set");
}

const authHeader = `Basic ${btoa(`${import.meta.env.VITE_API_USER}:${import.meta.env.VITE_API_PASS}`)}`;

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface Job {
  jobId: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;
  updatedAt?: string;
}

export async function fetchJobs(): Promise<{ jobs: Job[] }> {
  return apiFetch("/api/jobs") as Promise<{ jobs: Job[] }>;
}

export async function fetchDownloadUrl(
  jobId: string,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  return apiFetch(`/api/jobs/${jobId}/download-url`) as Promise<{
    downloadUrl: string;
    expiresAt: string;
  }>;
}
```

- [ ] **Step 4: TypeScript の型チェックを実行して型エラーがないことを確認する**

```bash
cd frontend && pnpm typecheck
```

期待される結果: エラーなし（`total` を参照していたコードは `TranslationListPage.tsx` になく、`useJobs.ts` も `data` をそのまま返しているのでエラーにならない）

- [ ] **Step 5: コミットする**

```bash
git add frontend/src/lib/api.ts frontend/.env.example
git commit -m "feat(frontend): replace mock api client with real fetch"
```

---

## Task 2: バックエンド CORS 設定の更新

**Files:**
- Modify: `backend/src/index.ts`

### なぜ変更が必要か

現在 `origin: ["http://localhost:5173"]` にハードコードされている。Amplify ドメインを本番環境で許可するために、`ALLOWED_ORIGIN` 環境変数から読み込む形に変更する。

> **注意**: Lambda Function URL の CORS は CDK の `addFunctionUrl` 設定が先に適用されるため、Hono ミドルウェアの CORS 設定だけ変えても不十分。Task 3 で CDK も変更する。

- [ ] **Step 1: `backend/src/index.ts` の CORS を更新する**

変更箇所（15〜22行目）を以下に差し替える:

> `origin` は配列 `string[]` で渡す（既存コードのスタイルを踏襲）。Hono の `cors` は `string` も `string[]` も受け付けるが、配列の方が複数オリジン追加時に拡張しやすい。

```ts
app.use(
  "/api/*",
  cors({
    origin: [process.env.ALLOWED_ORIGIN ?? "http://localhost:5173"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);
```

- [ ] **Step 2: TypeScript の型チェックを実行する**

```bash
cd backend && pnpm typecheck
```

期待される結果: エラーなし

- [ ] **Step 3: コミットする**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): read CORS allowed origin from env var"
```

---

## Task 3: CDK インフラの更新

**Files:**
- Modify: `infra/lib/translator-stack.ts`

### なぜ CDK も変更が必要か

Lambda Function URL の CORS ヘッダーは CDK の `addFunctionUrl` の `cors` オプションで制御され、Hono が返すヘッダーより優先される。現在 `allowedOrigins: ["*"]` になっているため、本番でも任意のオリジンからアクセス可能な状態。`ALLOWED_ORIGIN` 環境変数から読み込んで絞り込む。

- [ ] **Step 1: `infra/lib/translator-stack.ts` を更新する**

**Lambda 環境変数ブロック**（98〜103行目）を以下に差し替える:

```ts
      environment: {
        SOURCE_BUCKET: sourceBucket.bucketName,
        OUTPUT_BUCKET: outputBucket.bucketName,
        TRANSLATE_ROLE_ARN: backendRole.roleArn,
        NODE_ENV: "production",
        ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN ?? "http://localhost:5173",
      },
```

**Function URL CORS ブロック**（108〜115行目）を以下に差し替える:

```ts
    const functionUrl = backendFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [process.env.ALLOWED_ORIGIN ?? "http://localhost:5173"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["Authorization", "Content-Type"],
      },
    });
```

- [ ] **Step 2: CDK の型チェックを実行する**

```bash
cd infra && pnpm typecheck
```

期待される結果: エラーなし

- [ ] **Step 3: CDK diff で差分を確認する**（AWS 認証情報が設定されている場合）

```bash
ALLOWED_ORIGIN=https://your-app.amplifyapp.com pnpm diff
```

期待される出力例:
```
~ AWS::Lambda::Function BackendFunction
  ~ Properties:
    ~ Environment:
      ~ Variables:
        + ALLOWED_ORIGIN: https://your-app.amplifyapp.com

~ AWS::Lambda::Url BackendFunctionFunctionUrl
  ~ Properties:
    ~ Cors:
      ~ AllowOrigins:
        - *
        + https://your-app.amplifyapp.com
      ~ AllowHeaders:
        - *
        + Authorization
        + Content-Type
```

AWS 認証情報がない場合はスキップして次のステップへ。

- [ ] **Step 4: コミットする**

```bash
git add infra/lib/translator-stack.ts
git commit -m "feat(infra): restrict CORS to ALLOWED_ORIGIN env var"
```

---

## Task 4: Amplify ビルド設定の追加

**Files:**
- Create: `amplify.yml`（リポジトリルート）

- [ ] **Step 1: `amplify.yml` を作成する**

リポジトリルートに以下を作成:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm install -g pnpm
        - cd frontend && pnpm install --frozen-lockfile
    build:
      commands:
        - cd frontend && pnpm build
  artifacts:
    baseDirectory: frontend/dist
    files:
      - '**/*'
  cache:
    paths:
      - frontend/node_modules/**/*
```

> **注意**: Amplify では各フェーズ（preBuild / build）は**リポジトリルートから独立して実行**される。`preBuild` で `cd frontend` しても `build` フェーズには引き継がれない。そのため各フェーズで明示的に `cd frontend &&` を付ける。

- [ ] **Step 2: コミットする**

```bash
git add amplify.yml
git commit -m "feat(amplify): add build configuration"
```

---

## Task 5: ローカル統合テスト

バックエンドを起動した状態でフロントエンドが実 API を呼び出せることを確認する。

- [ ] **Step 1: バックエンドを起動する**

```bash
cd backend && pnpm dev
```

期待される出力:
```
Backend server running at http://localhost:3000
```

- [ ] **Step 2: 別ターミナルでフロントエンドを起動する**

```bash
cd frontend && pnpm dev
```

期待される出力:
```
  VITE v5.x.x  ready in ...ms
  ➜  Local:   http://localhost:5173/
```

- [ ] **Step 3: ブラウザで動作確認する**

`http://localhost:5173` を開き、以下を確認:

1. ブラウザの DevTools → Network タブを開く
2. `/api/jobs` へのリクエストが `200` を返すこと
3. `Authorization: Basic ...` ヘッダーが付いていること
4. レスポンスに `{ "jobs": [...] }` が含まれること
5. `COMPLETED` ステータスのジョブにダウンロードボタンが表示されること

- [ ] **Step 4: エラー確認**

`frontend/.env.local` の `VITE_API_USER` を空にしてページをリロードし、コンソールに `"VITE_API_USER and VITE_API_PASS must be set"` エラーが表示されることを確認する。確認後、正しい値に戻す。

---

## Amplify コンソール設定（デプロイ後の手動作業）

実装完了後、AWS Amplify コンソールで以下を設定する。これはコードではなくコンソール作業のためプランには含まれないが、忘れないよう記載する。

### 1. リポジトリ接続とアプリ作成
Amplify コンソール → 新しいアプリを作成 → Git リポジトリを接続 → `main` ブランチを選択

### 2. Rewrite ルール設定
Hosting → Rewrites and redirects:

| 優先順位 | Source | Target | Type |
|---|---|---|---|
| 1 | `/api/<*>` | `{Lambda Function URL}/api/<*>` | `200 (Rewrite)` |
| 2 | `</^[^.]+$\|\.(?!(css\|gif\|ico\|jpg\|js\|png\|txt\|svg\|woff\|ttf\|map\|json)$)([^.]+$)/>` | `/index.html` | `200 (Rewrite)` |

### 3. 環境変数設定
Environment variables:
- `VITE_API_USER` = Basic Auth ユーザー名
- `VITE_API_PASS` = Basic Auth パスワード

### 4. Amplify Basic Auth 有効化
Access control → Enable Basic auth → ユーザー名・パスワードを設定

### 5. CDK 再デプロイ（Amplify ドメイン確定後）

```bash
ALLOWED_ORIGIN=https://<amplify-app-id>.amplifyapp.com pnpm deploy
```

### 6. デプロイ後の動作確認

1. Amplify ドメインにアクセスし Basic Auth ダイアログが表示されることを確認
2. 認証後、ジョブ一覧が表示されることを確認
3. DevTools Network タブで `/api/jobs` が `200` を返し CORS エラーがないことを確認
