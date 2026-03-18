# 翻訳登録画面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一覧画面に「翻訳追加」ボタンを追加し、PowerPoint ファイルアップロード + 言語選択による翻訳登録フォーム画面を実装する。

**Architecture:** `App.tsx` の `useState` で `"list"` / `"create"` ビューを切り替える state-based ナビゲーション。新規フォームは `CreateTranslationPage` として実装し、3ステップのアップロードフロー（署名付きURL取得 → S3直接PUT → ジョブ作成）を `useCreateJob` mutation にカプセル化する。

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, TanStack Query v5, lucide-react

---

## File Map

| ファイル | 変更種別 | 責務 |
|---------|---------|------|
| `frontend/src/hooks/useLanguages.ts` | 新規 | `GET /api/languages` をラップし、`name` 昇順ソート済みの `Language[]` を返す |
| `frontend/src/hooks/useCreateJob.ts` | 新規 | S3アップロード → ジョブ作成の3ステップ mutation + キャッシュ無効化 |
| `frontend/src/components/FileDropZone.tsx` | 新規 | ドラッグ&ドロップ対応ファイル入力。バリデーション（拡張子・サイズ）はコンポーネント外の呼び出し元が行い、エラー文字列を `error` props で受け取る |
| `frontend/src/pages/CreateTranslationPage.tsx` | 新規 | フォーム全体の状態管理・バリデーション・送信処理 |
| `frontend/src/pages/TranslationListPage.tsx` | 変更 | `onNavigateCreate: () => void` props 追加、「翻訳追加」ボタン追加 |
| `frontend/src/App.tsx` | 変更 | `view` state 追加、`CreateTranslationPage` の条件レンダリング |

**Note on testing:** このプロジェクトにはテストフレームワークが未導入。各タスクの品質ゲートは `npm run typecheck`（TypeScript strict チェック）とする。

---

## Task 1: `useLanguages` hook

**Files:**
- Create: `frontend/src/hooks/useLanguages.ts`

- [ ] **Step 1: ファイルを作成する**

```typescript
// frontend/src/hooks/useLanguages.ts
import { useQuery } from "@tanstack/react-query";
import { fetchLanguages, type Language } from "../lib/api";

const languageKeys = {
  all: ["languages"] as const,
  list: () => [...languageKeys.all, "list"] as const,
};

export function useLanguages(): {
  languages: Language[];
  isPending: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: languageKeys.list(),
    queryFn: fetchLanguages,
  });

  const languages: Language[] = query.data
    ? [...query.data.languages].sort((a, b) =>
        a.name.localeCompare(b.name),
      )
    : [];

  return {
    languages,
    isPending: query.isPending,
    isError: query.isError,
  };
}
```

`fetchLanguages()` は `{ languages: Language[] }` を返す。hook 内で `query.data.languages` を取り出してソートしていることに注意。`query.data.languages` を直接ソートすると元の配列を破壊するため、スプレッドでコピーしてからソートする。

- [ ] **Step 2: 型チェックを通す**

```bash
cd frontend && npm run typecheck
```

エラーがなければ OK。

- [ ] **Step 3: コミット**

```bash
git add frontend/src/hooks/useLanguages.ts
git commit -m "feat(frontend): add useLanguages hook"
```

---

## Task 2: `useCreateJob` hook

**Files:**
- Create: `frontend/src/hooks/useCreateJob.ts`

このhookは3ステップのアップロードフローを1つの `useMutation` にまとめる。

- [ ] **Step 1: ファイルを作成する**

```typescript
// frontend/src/hooks/useCreateJob.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createJob, fetchUploadUrl, type CreateJobResponse } from "../lib/api";
import { jobKeys } from "../lib/queryKeys";

interface CreateJobParams {
  file: File;
  sourceLanguage: string;
  targetLanguage: string;
}

export function useCreateJob(onSuccess: () => void) {
  const queryClient = useQueryClient();

  return useMutation<CreateJobResponse, Error, CreateJobParams>({
    mutationFn: async ({ file, sourceLanguage, targetLanguage }) => {
      // Step 1: 署名付きアップロードURLを取得
      const { uploadUrl, key } = await fetchUploadUrl(file.name, file.type);

      // Step 2: S3へ直接PUT（apiFetch ではなく生の fetch を使う）
      // apiFetch は Authorization ヘッダーを付与するため S3 署名付きURLに送ると403になる。
      // Content-Type は fetchUploadUrl に渡した file.type と必ず一致させること。
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) {
        throw new Error(`S3 upload failed: ${uploadRes.status}`);
      }

      // Step 3: 翻訳ジョブを作成（HTTP 201）
      return createJob({
        sourceKey: key,
        sourceLanguage,
        targetLanguage,
        fileName: file.name,
      });
    },
    onSuccess: () => {
      // TanStack Query は mutation 成功を自動検知しない。
      // 明示的に invalidate してジョブ一覧を再フェッチさせる。
      queryClient.invalidateQueries({ queryKey: jobKeys.list() });
      onSuccess();
    },
  });
}
```

- [ ] **Step 2: 型チェックを通す**

```bash
cd frontend && npm run typecheck
```

- [ ] **Step 3: コミット**

```bash
git add frontend/src/hooks/useCreateJob.ts
git commit -m "feat(frontend): add useCreateJob mutation hook"
```

---

## Task 3: `FileDropZone` コンポーネント

**Files:**
- Create: `frontend/src/components/FileDropZone.tsx`

このコンポーネントはUIのみを担う。バリデーションロジック（拡張子・サイズチェック）はこのコンポーネント内に閉じており、結果を `onFileSelect(file, error)` で呼び出し元に伝える。

- [ ] **Step 1: ファイルを作成する**

```tsx
// frontend/src/components/FileDropZone.tsx
import { useRef, useState } from "react";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

interface Props {
  file: File | null;
  error: string | null;
  onFileSelect: (file: File | null, error: string | null) => void;
}

function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".pptx")) {
    return ".pptx ファイルを選択してください";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "ファイルサイズは 100MB 以下にしてください";
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDropZone({ file, error, onFileSelect }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    const err = validateFile(f);
    onFileSelect(err ? null : f, err);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    // 同じファイルを再選択できるようにリセット
    e.target.value = "";
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
      >
        {file ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium">ファイルをドラッグ&ドロップ</p>
            <p className="text-xs text-muted-foreground">または クリックして選択</p>
            <p className="text-xs text-muted-foreground">.pptx / 最大 100MB</p>
          </div>
        )}
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pptx"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
```

- [ ] **Step 2: 型チェックを通す**

```bash
cd frontend && npm run typecheck
```

- [ ] **Step 3: コミット**

```bash
git add frontend/src/components/FileDropZone.tsx
git commit -m "feat(frontend): add FileDropZone component"
```

---

## Task 4: `CreateTranslationPage` ページ

**Files:**
- Create: `frontend/src/pages/CreateTranslationPage.tsx`

`CreateTranslationPage` はフォームの全状態を管理する。`FileDropZone`・`useLanguages`・`useCreateJob` を組み合わせる。

バリデーションルール（再掲）:
- `.pptx` 以外: `.pptx ファイルを選択してください`
- 100MB 超: `ファイルサイズは 100MB 以下にしてください`
- 翻訳元 = 翻訳先: `翻訳元と翻訳先に同じ言語は選択できません`
- 送信ボタン活性条件: `file !== null && !fileError && sourceLanguage !== "" && targetLanguage !== "" && sourceLanguage !== targetLanguage`

- [ ] **Step 1: ファイルを作成する**

```tsx
// frontend/src/pages/CreateTranslationPage.tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { FileDropZone } from "../components/FileDropZone";
import { useCreateJob } from "../hooks/useCreateJob";
import { useLanguages } from "../hooks/useLanguages";

interface Props {
  onNavigateList: () => void;
}

export function CreateTranslationPage({ onNavigateList }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("");

  const { languages, isPending: isLoadingLanguages, isError: isLanguagesError } =
    useLanguages();
  const { mutate, isPending: isSubmitting, error: submitError } =
    useCreateJob(onNavigateList);

  const sameLanguageError =
    sourceLanguage && targetLanguage && sourceLanguage === targetLanguage
      ? "翻訳元と翻訳先に同じ言語は選択できません"
      : null;

  const canSubmit =
    file !== null &&
    !fileError &&
    sourceLanguage !== "" &&
    targetLanguage !== "" &&
    sourceLanguage !== targetLanguage;

  function handleFileSelect(f: File | null, error: string | null) {
    setFile(f);
    setFileError(error);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    mutate({ file, sourceLanguage, targetLanguage });
  }

  return (
    <section>
      <button
        type="button"
        onClick={onNavigateList}
        className="mb-6 text-sm text-muted-foreground hover:text-foreground"
      >
        ← 一覧に戻る
      </button>

      <h2 className="mb-6 text-xl font-semibold">翻訳登録</h2>

      <form onSubmit={handleSubmit} className="max-w-lg space-y-6">
        <FileDropZone
          file={file}
          error={fileError}
          onFileSelect={handleFileSelect}
        />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="source-language">
              翻訳元言語
            </label>
            <select
              id="source-language"
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value)}
              disabled={isLoadingLanguages || isLanguagesError}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">
                {isLoadingLanguages ? "読み込み中..." : "選択してください"}
              </option>
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="target-language">
              翻訳先言語
            </label>
            <select
              id="target-language"
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              disabled={isLoadingLanguages || isLanguagesError}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">
                {isLoadingLanguages ? "読み込み中..." : "選択してください"}
              </option>
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLanguagesError && (
          <p className="text-sm text-red-600">言語の取得に失敗しました</p>
        )}
        {sameLanguageError && (
          <p className="text-sm text-red-600">{sameLanguageError}</p>
        )}
        {submitError && (
          <p className="text-sm text-red-600">
            エラーが発生しました。時間をおいて再度お試しください。
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit || isSubmitting}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          翻訳を開始
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: 型チェックを通す**

```bash
cd frontend && npm run typecheck
```

- [ ] **Step 3: コミット**

```bash
git add frontend/src/pages/CreateTranslationPage.tsx
git commit -m "feat(frontend): add CreateTranslationPage"
```

---

## Task 5: `TranslationListPage` に「翻訳追加」ボタンを追加

**Files:**
- Modify: `frontend/src/pages/TranslationListPage.tsx`

`onNavigateCreate` props を追加し、ヘッダー行に「翻訳追加」ボタンを配置する。

- [ ] **Step 1: ファイルを編集する**

`frontend/src/pages/TranslationListPage.tsx` を以下に差し替える:

```tsx
import { Loader2 } from "lucide-react";
import { TranslationTable } from "../components/TranslationTable";
import { useJobs } from "../hooks/useJobs";

interface Props {
  onNavigateCreate: () => void;
}

export function TranslationListPage({ onNavigateCreate }: Props) {
  const { data, isPending, isError } = useJobs();

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">翻訳ジョブ一覧</h2>
        <button
          type="button"
          onClick={onNavigateCreate}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          翻訳追加
        </button>
      </div>

      {isPending && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          <span>読み込み中...</span>
        </div>
      )}

      {isError && (
        <p className="py-8 text-center text-sm text-red-600">
          データの取得に失敗しました。時間をおいて再度お試しください。
        </p>
      )}

      {data && data.jobs.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">翻訳ジョブがありません</p>
      )}

      {data && data.jobs.length > 0 && <TranslationTable jobs={data.jobs} />}
    </section>
  );
}
```

- [ ] **Step 2: 型チェックを通す**

```bash
cd frontend && npm run typecheck
```

エラーが出る場合: `App.tsx` がまだ `onNavigateCreate` を渡していないため。次の Task 6 で解消する。エラー内容を確認だけして次に進む。

- [ ] **Step 3: コミット**

```bash
git add frontend/src/pages/TranslationListPage.tsx
git commit -m "feat(frontend): add 翻訳追加 button to TranslationListPage"
```

---

## Task 6: `App.tsx` に view state を追加してビューを繋ぐ

**Files:**
- Modify: `frontend/src/App.tsx`

`view` state を追加し、`"list"` と `"create"` を切り替える。これで全体が繋がる。

- [ ] **Step 1: ファイルを編集する**

```tsx
// frontend/src/App.tsx
import { useState } from "react";
import { CreateTranslationPage } from "./pages/CreateTranslationPage";
import { TranslationListPage } from "./pages/TranslationListPage";

function App() {
  const [view, setView] = useState<"list" | "create">("list");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Translator V2</h1>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        {view === "list" ? (
          <TranslationListPage onNavigateCreate={() => setView("create")} />
        ) : (
          <CreateTranslationPage onNavigateList={() => setView("list")} />
        )}
      </main>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: 型チェックを通す（エラーゼロを確認）**

```bash
cd frontend && npm run typecheck
```

Expected: エラーなし

- [ ] **Step 3: 開発サーバーで動作確認**

```bash
cd frontend && npm run dev
```

確認項目:
- [ ] トップ画面に「翻訳追加」ボタンが表示される
- [ ] 「翻訳追加」ボタンを押すと翻訳登録フォームに遷移する
- [ ] 「← 一覧に戻る」ボタンで一覧に戻れる
- [ ] `.pptx` 以外のファイルをドロップするとエラーが表示される
- [ ] 100MB を超えるファイルをドロップするとエラーが表示される
- [ ] 翻訳元・翻訳先に同じ言語を選ぶとエラーが表示される
- [ ] 条件を満たすまで「翻訳を開始」ボタンが disabled のまま

- [ ] **Step 4: コミット**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): wire up create translation view in App"
```
