# フロントエンド開発ガイドライン

## 技術スタック

| カテゴリ | ライブラリ | バージョン |
|---------|-----------|----------|
| UIフレームワーク | React | 18.x |
| 言語 | TypeScript | 5.x |
| ビルドツール | Vite | 5.x |
| スタイリング | Tailwind CSS | 4.x |
| サーバー状態管理 | TanStack Query | 5.x |
| ヘッドレスUI | Radix UI | 最新 |
| アイコン | Lucide React | 最新 |
| Linter / Formatter | Biome | 2.x |

---

## ディレクトリ構成

```
frontend/src/
├── components/     # 再利用可能なUIコンポーネント
│   └── ui/         # Radix UI ベースの基盤コンポーネント
├── hooks/          # カスタムフック
├── pages/          # ページコンポーネント（ルートに対応）
├── lib/            # ユーティリティ・API クライアント
├── App.tsx
├── main.tsx
└── index.css
```

### ファイル配置の方針

- **コンポーネント単位のファイル**: 1コンポーネント = 1ファイル
- **ページは `pages/`**: ルートに対応するトップレベルコンポーネントのみ
- **API 関連は `lib/`**: fetch ラッパー・型定義・ヘルパーを集約
- **副作用ロジックは `hooks/`**: データ取得・イベント処理などはカスタムフックに切り出す

---

## コンポーネント設計

### 基本方針

- **関数コンポーネント** のみ使用（クラスコンポーネント禁止）
- **Server Components は使わない**（Vite + SPA 構成のため）
- コンポーネントは**単一責任**を保つ。肥大化したら分割する

### 型定義

props は必ずインターフェースで型定義する。

```tsx
interface TranslationCardProps {
  jobId: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  fileName: string;
  onDownload: (jobId: string) => void;
}

export function TranslationCard({ jobId, status, fileName, onDownload }: TranslationCardProps) {
  // ...
}
```

### コンポーネントのエクスポート

- named export を使う（`export default` は `App.tsx` のみ許容）

```tsx
// Good
export function LanguageSelector() { ... }

// Avoid
export default function LanguageSelector() { ... }
```

---

## スタイリング (Tailwind CSS v4)

### 基本ルール

- クラス名の合成には `cn()` ユーティリティを使う（`clsx` + `tailwind-merge`）

```tsx
import { cn } from "@/lib/utils";

function Button({ className, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "px-4 py-2 rounded-md font-medium transition-colors",
        "bg-primary text-primary-foreground hover:bg-primary/90",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}
```

- バリアントを持つコンポーネントは **CVA (class-variance-authority)** を使う

```tsx
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input hover:bg-accent",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-sm",
        lg: "h-11 px-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
```

### Tailwind CSS v4 の注意点

- v4 では `tailwind.config.js` が不要（CSS ファイルで設定）
- カスタムカラーは `index.css` 内の CSS 変数で定義する
- `@apply` の使用は最小限にとどめる

---

## サーバー状態管理 (TanStack Query v5)

### 基本セットアップ

```tsx
// main.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5分
      retry: 1,
    },
  },
});
```

### クエリキーの管理

クエリキーはファクトリ関数で一元管理する。

```tsx
// lib/queryKeys.ts
export const jobKeys = {
  all: ["jobs"] as const,
  list: () => [...jobKeys.all, "list"] as const,
  detail: (id: string) => [...jobKeys.all, "detail", id] as const,
};
```

### データ取得フック

カスタムフックに切り出し、コンポーネントからクエリロジックを分離する。

```tsx
// hooks/useJobs.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { jobKeys } from "@/lib/queryKeys";
import { fetchJobs, createJob } from "@/lib/api";

export function useJobs() {
  return useQuery({
    queryKey: jobKeys.list(),
    queryFn: fetchJobs,
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.list() });
    },
  });
}
```

### ローディング・エラー処理

`isPending` / `isError` を使ってUIに反映する。

```tsx
function JobList() {
  const { data, isPending, isError } = useJobs();

  if (isPending) return <div>読み込み中...</div>;
  if (isError) return <div>エラーが発生しました</div>;

  return <ul>{data.jobs.map((job) => <JobItem key={job.jobId} job={job} />)}</ul>;
}
```

---

## API クライアント

### fetch ラッパー

型安全な API クライアントを `lib/api.ts` に集約する。

```tsx
// lib/api.ts
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchJobs() {
  return apiRequest<{ jobs: Job[]; total: number }>("/api/jobs");
}
```

### 環境変数

- 環境変数は `VITE_` プレフィックスをつける
- 型は `vite-env.d.ts` で宣言する

```ts
// vite-env.d.ts
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}
```

---

## Radix UI の使い方

Radix UI はアクセシビリティ対応のヘッドレスコンポーネント。スタイルは Tailwind で付与する。

```tsx
import * as Dialog from "@radix-ui/react-dialog";

function ConfirmDialog({ onConfirm }: { onConfirm: () => void }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="px-4 py-2 bg-destructive text-white rounded-md">削除</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background p-6 rounded-lg shadow-lg">
          <Dialog.Title className="text-lg font-semibold">本当に削除しますか？</Dialog.Title>
          <div className="mt-4 flex gap-2 justify-end">
            <Dialog.Close asChild>
              <button className="px-4 py-2 border rounded-md">キャンセル</button>
            </Dialog.Close>
            <button className="px-4 py-2 bg-destructive text-white rounded-md" onClick={onConfirm}>
              削除
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

---

## コード品質

### Biome

Biome を linter / formatter として使用。設定は `biome.json`（ルート）で管理。

```bash
# チェック
pnpm lint

# 自動修正
pnpm lint:fix

# フォーマット
pnpm format
```

主な設定：
- インデント: スペース 2
- 行幅: 100
- クォート: ダブルクォート
- 末尾カンマ: あり (`all`)

### TypeScript

- `strict: true` を維持する
- `any` は使用禁止。型が不明な場合は `unknown` を使い、型ガードで絞り込む
- 型アサーション（`as`）は最小限にとどめる

### コミット前チェック

Lefthook により、コミット前に自動で lint と typecheck が実行される。

---

## 開発フロー

```bash
# 開発サーバー起動
pnpm dev:frontend

# 型チェック
pnpm typecheck

# lint
pnpm lint
```
