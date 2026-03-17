# 翻訳一覧画面 設計ドキュメント

## 目的

翻訳を依頼したユーザーが、過去に投入したジョブの状況（進行中・完了・失敗）を一目で確認し、翻訳完了したファイルをダウンロードできるようにするため。

---

## 画面仕様

### レイアウト概要

`pages/TranslationListPage.tsx` として実装し、`App.tsx` の `<main>` 内にマウントする。

テーブルはシンプルな構成とし、以下のカラムを表示する。

| # | カラム名 | 表示内容 |
|---|---------|---------|
| 1 | 翻訳元ファイル名 | `job.fileName` |
| 2 | 翻訳開始日時 | `job.createdAt`（ISO 8601 → ローカル日時形式に変換して表示） |
| 3 | 翻訳ステータス | `job.status` をバッジ表示（後述） |
| 4 | ダウンロード | `status === "COMPLETED"` のときのみボタンを表示。それ以外は空セル |

### ステータス表示仕様

`status` の値に応じてバッジのスタイルを変える。

| status 値 | 表示テキスト | スタイルイメージ |
|-----------|-----------|--------------|
| `SUBMITTED` | 待機中 | グレー |
| `IN_PROGRESS` | 翻訳中 | ブルー |
| `COMPLETED` | 完了 | グリーン |
| `FAILED` | 失敗 | レッド |

### ローディング・エラー表示

- データ取得中（`isPending`）: テーブル領域にスピナーを表示
- エラー発生時（`isError`）: エラーメッセージを表示
- ジョブが 0 件: 「翻訳ジョブがありません」と表示

---

## コンポーネント構成

```
pages/
└── TranslationListPage.tsx   # 一覧ページ（データ取得・テーブル描画）

components/
├── TranslationTable.tsx       # テーブル本体
├── TranslationStatusBadge.tsx # ステータスバッジ
└── DownloadButton.tsx         # ダウンロードボタン
```

### 各コンポーネントの責務

| コンポーネント | 責務 |
|--------------|------|
| `TranslationListPage` | `useJobs` フックでデータ取得し、`TranslationTable` に渡す。ローディング・エラー状態を制御 |
| `TranslationTable` | `Job[]` を受け取り `<table>` でレンダリング |
| `TranslationStatusBadge` | `status` を受け取りバッジを返す純粋コンポーネント |
| `DownloadButton` | `jobId` を受け取り、クリック時にダウンロード URL 取得 → ファイルダウンロードを実行 |

---

## データフロー

### 一覧取得

```
TranslationListPage
  └─ useJobs()  (hooks/useJobs.ts)
       └─ TanStack Query → GET /api/jobs
            └─ レスポンス: { jobs: Job[], total: number }
```

### ダウンロード

完了済みジョブのダウンロードは、バックエンドが発行する Presigned URL 経由で行う。

```
DownloadButton クリック
  └─ useDownloadJob(jobId)  (hooks/useDownloadJob.ts)
       └─ TanStack Query (useMutation) → GET /api/jobs/:job_id/download
            └─ レスポンス: { downloadUrl: string }
                 └─ window.open(downloadUrl) でダウンロード開始
```

---

## 型定義

`lib/api.ts` またはインポート元のファイルに配置する共有型。

```
interface Job {
  jobId: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  createdAt: string;   // ISO 8601
  updatedAt?: string;  // ISO 8601
}
```

---

## API

| 用途 | メソッド | パス | レスポンス |
|------|---------|------|-----------|
| ジョブ一覧取得 | GET | `/api/jobs` | `{ jobs: Job[], total: number }` |
| ダウンロード URL 取得 | GET | `/api/jobs/:job_id/download` | `{ downloadUrl: string }` |

---

## クエリキー管理

`lib/queryKeys.ts` に追加する。

```
export const jobKeys = {
  all: ["jobs"] as const,
  list: () => [...jobKeys.all, "list"] as const,
  detail: (id: string) => [...jobKeys.all, "detail", id] as const,
};
```

---

## ファイル配置まとめ

| ファイル | 役割 |
|--------|------|
| `pages/TranslationListPage.tsx` | 一覧ページ |
| `components/TranslationTable.tsx` | テーブル本体 |
| `components/TranslationStatusBadge.tsx` | ステータスバッジ |
| `components/DownloadButton.tsx` | ダウンロードボタン |
| `hooks/useJobs.ts` | ジョブ一覧取得フック |
| `hooks/useDownloadJob.ts` | ダウンロード URL 取得フック |
| `lib/api.ts` | `fetchJobs` / `fetchDownloadUrl` 関数 |
| `lib/queryKeys.ts` | `jobKeys` クエリキーファクトリ |
