# ADR-001: プロジェクト初期設計

- **ステータス**: 提案
- **日付**: 2026-03-11

---

## 概要

Amazon Translate を使った PowerPoint ファイル翻訳 Web アプリケーションの初期アーキテクチャを決定する。

---

## 要件

| 要件 | 詳細 |
|------|------|
| ファイルアップロード | ブラウザから PPTX ファイルをアップロード |
| 言語選択 | ユーザーが翻訳元言語・翻訳先言語を UI で選択できる |
| バッチ翻訳 | Amazon Translate のバッチ翻訳ジョブを実行 |
| ステータス確認 | 翻訳中・翻訳完了などのジョブステータスを表示 |
| ファイルダウンロード | 翻訳完了後に結果ファイルをダウンロード |
| 認証 | Basic 認証のみ。ユーザー間の分離なし（全ジョブが全員に見える） |
| データベース | 不使用。ステータスは Amazon Translate API から都度取得 |
| デプロイ先 | AWS。月額コストを最小化することを優先 |

---

## システムアーキテクチャ

### 構成図

```
[ブラウザ]
    │
    │ HTTPS
    ▼
[CloudFront]
    ├─── 静的ファイル配信 ──► [S3: フロントエンドバケット]
    │
    └─── /api/* ──► [API Gateway (HTTP API)]
                          │
                          └─ [Lambda (Node.js)]
                             └── Hono basicAuth middleware
                                │
                                ├── S3 署名付きURL発行
                                ├── Amazon Translate ジョブ管理
                                └── ジョブステータス取得
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
             [S3: 入力バケット]  [Amazon Translate]  [S3: 出力バケット]
             (アップロード先)    (バッチ翻訳ジョブ)   (翻訳結果)
```

### データフロー

1. **アップロード**: ブラウザ → API → 署名付き PUT URL → S3 入力バケットへ直接 PUT
2. **翻訳開始**: ブラウザ → API → Lambda → `StartTextTranslationJob` (Amazon Translate)
3. **ステータス確認**: ブラウザ → API → Lambda → `ListTextTranslationJobs` / `DescribeTextTranslationJob`
4. **ダウンロード**: ブラウザ → API → Lambda → 出力バケットの署名付き GET URL → 直接ダウンロード

---

## 技術スタック

### フロントエンド

| 項目 | 選択 | 理由 |
|------|------|------|
| フレームワーク | React + TypeScript | SPA として S3 にデプロイ可能。シンプルな構成 |
| ビルドツール | Vite | 高速ビルド、設定が少ない |
| UIライブラリ | shadcn/ui + Tailwind CSS | 軽量、カスタマイズ性が高い |
| ステート管理 | TanStack Query | APIポーリング（ステータス確認）との親和性が高い |
| HTTPクライアント | fetch (ネイティブ) | 追加依存なし |

### バックエンド

| 項目 | 選択 | 理由 |
|------|------|------|
| ランタイム | Node.js 22 (TypeScript) | フロントエンドと言語統一。型定義の共有が可能 |
| フレームワーク | Hono | Lambda / Node.js 両対応、軽量、型安全なルーティング |
| パッケージ管理 | pnpm (monorepo) | フロントエンドと同一のパッケージマネージャーで管理 |

### インフラ (IaC)

| 項目 | 選択 | 理由 |
|------|------|------|
| IaC | AWS CDK (TypeScript) | AWS 公式、型補完、Lambda / S3 / CloudFront の定義が容易 |

---

## AWS サービス構成

| サービス | 用途 | コスト概算 |
|----------|------|-----------|
| CloudFront | フロントエンド配信 + API リバースプロキシ | ほぼ無料（低トラフィック時） |
| S3 (フロントエンド) | React 静的ファイルホスティング | ~$0.02/GB |
| S3 (入力/出力) | PPTX ファイルの保存 | ~$0.02/GB ストレージ + リクエスト料金 |
| API Gateway (HTTP API) | Lambda のエンドポイント | $1.00/100万リクエスト |
| Lambda | バックエンド処理 | 100万リクエスト/月まで無料枠 |
| Amazon Translate | バッチ翻訳 | $15/100万文字 |
| SSM Parameter Store | Basic 認証資格情報の保存 | 無料（Standard パラメータ） |

> 月次コスト試算: 翻訳量次第だが、インフラ費用は **$1〜5/月** 程度（翻訳コスト除く）

---

## API 設計

| メソッド | パス | 説明 |
|--------|------|------|
| `GET` | `/api/languages` | Amazon Translate がサポートする言語一覧を返す |
| `GET` | `/api/upload-url` | S3 署名付き PUT URL を発行 |
| `POST` | `/api/jobs` | 翻訳ジョブを開始（翻訳元・翻訳先言語コードを受け取る） |
| `GET` | `/api/jobs` | 全翻訳ジョブ一覧を取得 |
| `GET` | `/api/jobs/{job_id}` | 特定ジョブのステータスを取得 |
| `GET` | `/api/jobs/{job_id}/download-url` | 翻訳結果の S3 署名付き GET URL を発行 |

すべてのエンドポイントは Hono `basicAuth` ミドルウェアによる Basic 認証を要求する。

### `POST /api/jobs` リクエストボディ（例）

```json
{
  "file_key": "uploads/20260311T120000_slides.pptx",
  "source_language_code": "ja",
  "target_language_code": "en"
}
```

### 言語選択 UI の方針

- `/api/languages` で Amazon Translate の `ListLanguages` API を呼び出し、サポート言語をセレクトボックスに表示する
- 翻訳元言語には「自動検出 (auto)」オプションも追加する（Amazon Translate がソース言語を自動識別）

---

## 認証方式

- **方式**: HTTP Basic 認証
- **実装**: Hono `basicAuth` ミドルウェア（Lambda Authorizer は不使用）
- **資格情報保存**: AWS SSM Parameter Store (SecureString)
- **制約**: ユーザー単位の分離なし。認証はアクセス制御のみを目的とする

---

## ディレクトリ構成（案）

```
translator-v2/
├── docs/
│   └── adr/
│       └── init_project.md
├── frontend/               # React + Vite
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   └── lib/
│   ├── package.json
│   └── vite.config.ts
├── backend/                # Hono (Node.js + TypeScript)
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   └── services/
│   ├── package.json
│   └── tsconfig.json
├── infra/                  # AWS CDK
│   ├── bin/
│   ├── lib/
│   └── package.json
└── README.md
```

---

## Amazon Translate バッチ翻訳の仕様

- **対応フォーマット**: PPTX をネイティブサポート（レイアウト・書式を維持して翻訳）
- **入力**: S3 バケット上の PPTX ファイル
- **出力**: 指定した S3 バケットのプレフィックス配下に翻訳済み PPTX を出力
- **ステータス管理**: DB 不要。`DescribeTextTranslationJob` / `ListTextTranslationJobs` API でジョブ状態を取得
- **ジョブの識別**: `StartTextTranslationJob` 時に `JobName` を指定（ファイル名 + タイムスタンプ）

---

## 決定事項まとめ

| 決定 | 内容 |
|------|------|
| ホスティング | Lambda + API Gateway + S3 + CloudFront（サーバーレス）でコスト最小化 |
| DB不使用 | Amazon Translate API をステータスのソース・オブ・トゥルースとする |
| 認証 | Hono `basicAuth` ミドルウェアによる Basic 認証。Lambda Authorizer より軽量で実装コストが低い |
| IaC | AWS CDK でインフラをコード管理 |
| ファイル転送 | 大容量ファイル対応のため、Lambda を経由せず S3 署名付き URL で直接転送 |
| 言語統一 | フロントエンド・バックエンド・IaC をすべて TypeScript に統一。型定義の共有が可能 |

---

## 未決定事項 / 今後の検討事項

- [ ] S3 バケットのライフサイクルポリシー（古いジョブファイルの自動削除期間）
- [x] 翻訳対象言語の選択 UI → ユーザーが翻訳元・翻訳先をセレクトボックスで選択する形式に決定
- [ ] ファイルサイズの上限設定
- [ ] エラー時の UI/UX（ジョブ失敗時の表示、リトライ可否）
- [ ] CI/CD パイプライン（GitHub Actions 等）
