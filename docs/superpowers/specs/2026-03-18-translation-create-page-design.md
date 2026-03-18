# 翻訳登録画面 設計書

- **日付**: 2026-03-18
- **ステータス**: Approved

## 概要

フロントエンドに翻訳登録画面を追加する。一覧画面の「翻訳追加」ボタンから遷移し、PowerPoint ファイルのアップロードと翻訳言語の指定を行い、AWS Translate バッチ翻訳ジョブを開始する。

---

## ナビゲーション

`react-router-dom` は導入しない。`App.tsx` に `useState` を追加し、`"list"` と `"create"` の2ビューを切り替える state-based ナビゲーションを採用する。

```tsx
// App.tsx
const [view, setView] = useState<"list" | "create">("list");
```

- 一覧画面の「翻訳追加」ボタン押下 → `setView("create")`
- 登録フォームの「← 一覧に戻る」リンク押下 → `setView("list")`
- ジョブ作成成功後 → `setView("list")`

---

## コンポーネント構成

```
App.tsx                          # view state を管理、TranslationListPage / CreateTranslationPage を切り替え

pages/
  TranslationListPage.tsx        # 既存。「翻訳追加」ボタンを追加し onNavigateCreate コールバックを受け取る
  CreateTranslationPage.tsx      # 新規。フォーム全体を管理

components/
  FileDropZone.tsx               # 新規。ドラッグ&ドロップ対応ファイル入力

hooks/
  useLanguages.ts                # 新規。GET /api/languages をラップする TanStack Query hook
  useCreateJob.ts                # 新規。3ステップアップロードをまとめた TanStack Query mutation
```

---

## UI レイアウト

センタードフォーム（中央寄せ）。`App.tsx` の `<main className="container mx-auto px-4 py-8">` 内に `CreateTranslationPage` を直接レンダリングするため、既存の `TranslationListPage` と同じページ幅制約が自動的に適用される。`CreateTranslationPage` 自身は追加のコンテナラッパーを持たない。

```
[← 一覧に戻る]

翻訳登録

┌─────────────────────────────────────┐
│  📎 ファイルをドラッグ&ドロップ      │  ← FileDropZone
│     または クリックして選択           │
│     .pptx  /  最大 100MB            │
└─────────────────────────────────────┘

[翻訳元言語 ▾]   [翻訳先言語 ▾]      ← 横並び

[翻訳を開始]                          ← 条件を満たすまで disabled
```

ファイル選択後はドロップゾーン内にファイル名とサイズを表示する。ドラッグオーバー中はドロップゾーンのボーダーと背景色をハイライト表示する（実装はコンポーネントに委ねる）。

---

## バリデーション

| 条件 | エラーメッセージ |
|------|----------------|
| 拡張子が `.pptx` 以外 | 「.pptx ファイルを選択してください」 |
| ファイルサイズが 100MB 超 | 「ファイルサイズは 100MB 以下にしてください」 |
| 翻訳元と翻訳先に同じ言語を選択 | 「翻訳元と翻訳先に同じ言語は選択できません」|
| ファイル未選択 または 言語未選択 | 「翻訳を開始」ボタンを disabled（エラーメッセージなし）|

バリデーションはクライアントサイドのみ。エラーはドロップゾーン直下にインライン表示する。

---

## データフロー（アップロード → ジョブ作成）

`useCreateJob` mutation が以下の3ステップを順番に実行する。

```
1. fetchUploadUrl(file.name, file.type)
   GET /api/upload-url?fileName=...&contentType=...
   → { uploadUrl, key }

2. fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
   S3 署名付き URL へ直接アップロード
   ※ apiFetch を使わないこと（Authorization ヘッダーを付与すると 403 になる）
   ※ contentType は手順 1 と必ず一致させること

3. createJob({ sourceKey: key, sourceLanguage, targetLanguage, fileName: file.name })
   POST /api/jobs → 201
```

---

## 状態管理

| 状態 | 型 | 説明 |
|------|----|------|
| `file` | `File \| null` | 選択されたファイル |
| `sourceLanguage` | `string` | 翻訳元言語コード（例: `"ja"`） |
| `targetLanguage` | `string` | 翻訳先言語コード（例: `"en"`） |
| `fileError` | `string \| null` | ファイルバリデーションエラーメッセージ |

送信ボタンの活性条件: `file !== null && !fileError && sourceLanguage !== "" && targetLanguage !== "" && sourceLanguage !== targetLanguage`

---

## エラーハンドリング

- **ファイルバリデーションエラー**: ドロップゾーン直下にインライン表示
- **API エラー（アップロード / ジョブ作成失敗）**: フォーム下部にエラーメッセージを表示。再試行可能（ボタンを再び押せる状態に戻す）
- **言語一覧取得失敗**: セレクトボックス非活性 + 「言語の取得に失敗しました」を表示

---

## 言語セレクトボックス

`useLanguages` hook で `GET /api/languages` を取得し、ソート済みの `Language[]` を両セレクトに渡す。

`fetchLanguages()` は `{ languages: Language[] }` を返すため、hook 内で `data.languages` を取り出してから `name` 昇順でソートして返す。

- ローディング中: セレクト disabled、プレースホルダー「読み込み中...」
- 取得成功: 言語名でソートして表示（`language.name` 昇順）
- デフォルト選択なし（空選択状態から始める）

---

## 成功時の動作

ジョブ作成成功後、以下の2つを行う:

1. `queryClient.invalidateQueries({ queryKey: jobKeys.list() })` を呼び出してジョブ一覧キャッシュを無効化する（TanStack Query は mutation 成功を自動検知しないため、明示的な invalidate が必須）
2. `setView("list")` を呼び出して一覧画面に戻る

---

## 変更ファイル一覧

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `frontend/src/App.tsx` | 変更 | `view` state 追加、`CreateTranslationPage` の条件レンダリング追加 |
| `frontend/src/pages/TranslationListPage.tsx` | 変更 | `onNavigateCreate` props 追加、「翻訳追加」ボタン追加 |
| `frontend/src/pages/CreateTranslationPage.tsx` | 新規 | 翻訳登録フォームページ |
| `frontend/src/components/FileDropZone.tsx` | 新規 | ドラッグ&ドロップ対応ファイル入力コンポーネント |
| `frontend/src/hooks/useLanguages.ts` | 新規 | 言語一覧取得 hook |
| `frontend/src/hooks/useCreateJob.ts` | 新規 | 3ステップジョブ作成 mutation hook |

---

## スコープ外

- バックエンド変更（`CreateJobRequest` へのカスタムジョブ名追加は行わない）
- ルーティング（`react-router-dom` は導入しない）
- アップロード進捗バー（スピナーのみ）
