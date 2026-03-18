# ADR-002: フロントエンドから Lambda URL を直接呼び出す

- **ステータス**: 承認済み
- **日付**: 2026-03-18
- **関連**: ADR-001（初期設計では CloudFront + API Gateway 経由を想定）

---

## 概要

当初の設計から変更し、フロントエンドから Amplify のリバースプロキシを経由せず、Lambda Function URL を直接呼び出す構成に変更する。

---

## 背景・経緯

### 実装上の問題

Amplify Hosting へのデプロイ後、`/api/*` へのリクエストがすべて HTTP 500 を返す障害が発生した。

**調査結果**:

1. Lambda のログに `HTTPException` (401) が記録されており、Basic 認証が失敗していた
2. Amplify の Rewrites and Redirects で `/api/<*>` → Lambda URL へのプロキシを設定していたが、CloudFront がリクエストの `Authorization` ヘッダーを Lambda に転送していないことが判明した

```
# Lambda ログ（デバッグ用に追加したログ）
[auth] Authorization header present: false
```

3. Lambda URL への直接アクセスは正常に動作することを確認済み

### CloudFront が Authorization ヘッダーを転送しない理由

CloudFront は Origin Request Policy によって転送するヘッダーを制御する。Amplify が管理する CloudFront ディストリビューションでは、リライトルールで使用されるオリジンリクエストポリシーに `Authorization` ヘッダーが含まれない。

Amplify Console の UI からこの CloudFront 設定を変更する手段はなく、IaC（CDK）レベルでの対応も Amplify 管理のディストリビューションに手を入れることになるため保守性が低下する。

---

## 決定事項

フロントエンドから Lambda Function URL を **直接** 呼び出す。

### 構成変更

**変更前**:
```
[ブラウザ] → [Amplify/CloudFront: /api/*] → (rewrite) → [Lambda URL]
                                                    ※ Authorization ヘッダーが削除される
```

**変更後**:
```
[ブラウザ] ──── 静的ファイル ────► [Amplify/CloudFront]
     │
     └── API リクエスト (VITE_API_BASE_URL) ──► [Lambda URL]
                                                    ※ Authorization ヘッダーがそのまま到達
```

### 対応内容

| 項目 | 内容 |
|------|------|
| フロントエンド | `VITE_API_BASE_URL` 環境変数で Lambda URL のベース URL を指定。相対パス `/api/*` から絶対 URL に変更 |
| Lambda (CORS) | `ALLOWED_ORIGIN` に Amplify アプリの URL を設定し、ブラウザからのクロスオリジンリクエストを許可 |
| Amplify リライト | `/api/<*>` → Lambda URL のプロキシルールを削除 |
| Amplify 環境変数 | `VITE_API_BASE_URL` を Amplify Console の環境変数に追加 |

---

## 採用しなかった代替案

### 案A: CloudFront の Origin Request Policy を変更する

`Authorization` ヘッダーを含む Origin Request Policy を AWS CLI / CDK で作成し、Amplify が管理する CloudFront ディストリビューションの該当ビヘイビアに適用する。

**却下理由**: Amplify が管理するリソースに直接手を入れることになり、次回の Amplify デプロイで設定が上書きされるリスクがある。

### 案B: 認証方式をカスタムヘッダーに変更する

`Authorization` ヘッダーの代わりに CloudFront が転送する別のヘッダー（例: `X-API-Key`）を使う。

**却下理由**: Basic 認証という既定の標準から外れ、クライアント実装・テストが複雑になる。また、カスタムヘッダーが CloudFront に転送されるよう別途設定が必要であり、本質的な解決にならない。

### 案C: API Gateway (HTTP API) を前段に置く

Lambda Function URL の前に API Gateway を配置し、API Gateway で Basic 認証を処理する。

**却下理由**: コスト・複雑性の増加が ADR-001 の「コスト最小化」方針に反する。また現時点で API Gateway の追加機能（レート制限、キャッシュ等）は不要。

---

## トレードオフ

| 観点 | 影響 |
|------|------|
| セキュリティ | Lambda URL が公開されるが、Basic 認証で保護されているため許容範囲。URL が漏洩しても認証なしではアクセスできない |
| CORS | ブラウザのクロスオリジンポリシーにより、`ALLOWED_ORIGIN` に一致するオリジンのみ許可される |
| インフラ簡素化 | Amplify のリライトルール削除により、プロキシ層がなくなりデバッグが容易になる |
| レイテンシ | プロキシを経由しなくなるため、むしろわずかに改善される |

---

## 結論

CloudFront のヘッダー転送制限を回避しつつ、最小限の変更で問題を解決できる「Lambda URL 直接呼び出し」を採用する。
