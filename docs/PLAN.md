# 実装計画

> **2026-10-13 構成変更:** 本番を Xserver 共用サーバー（静的ファイルのみ配信）で運用するため、
> Next.js のサーバー機能（サーバーアクション・Route Handler・proxy）を廃止し、静的書き出し（`output: "export"`）に変更した。
> 権限検証・トランザクション・トークン生成と照合・入力検証・レート制限はすべて Supabase の DB 関数で行う。
> デモは Supabase なしでブラウザ内に保存するデモモードを GitHub Pages で公開する。
> 以下は当初計画（Vercel 前提）の記録で、現在の構成は README.md・docs/DEPLOY.md・docs/SECURITY.md を参照。

# 当初の実装計画（フェーズ1）

## 1. 現状確認の結果

- 既存プロジェクトなし。Next.js 16.4 の公式スキャフォールドから新規作成。
- ローカルに Docker / Supabase CLI / psql は未導入。
  - DB テストは `embedded-postgres`（実 PostgreSQL 18 バイナリ）上で、Supabase の `auth.uid()`・ロール（anon / authenticated / service_role）を再現するシムを当てて実行する。
  - 実際の Supabase プロジェクトには**未接続**。接続手順は `docs/DEPLOY.md` を参照。

## 2. 採用バージョン

| パッケージ | バージョン | 用途 |
|---|---|---|
| next | 16.4.0 | App Router（`middleware` は `proxy.ts` に改名済み） |
| react / react-dom | 19.3.0 | |
| @supabase/supabase-js | 2.117.3 | DB / Auth |
| @supabase/ssr | 0.12.7 | Cookie セッション |
| zod | 4.6.7 | 入力検証（クライアント・サーバー共通スキーマ） |
| qrcode | 1.5.4 | QR 画像（SVG / PNG） |
| pdf-lib | 1.17.1 | 印刷用 PDF（純 JS、Vercel で動作） |
| vitest | 5.0.4 | テスト |
| embedded-postgres / pg | 18.4.0-beta.17 / 8.23 | DB 統合テスト |

`cacheComponents` は**無効化**。管理データ・個人情報はキャッシュ対象にしないため、全画面を動的レンダリングとする。

## 3. ディレクトリ構成

```
supabase/
  config.toml                 # enable_signup = false（管理者の自己登録禁止）
  migrations/
    *_schema.sql              # テーブル・制約・インデックス
    *_functions.sql           # 業務処理（トランザクション）用 DB 関数
    *_security.sql            # RLS・権限
src/
  proxy.ts                    # /admin のセッション更新と未ログイン時リダイレクト（楽観チェック）
  app/
    admin/login/              # ログイン
    admin/(protected)/        # ダッシュボード・QR発行・一覧・住所・発送・操作履歴（各所で requireAdmin）
    api/admin/qr/pdf/         # 印刷用 PDF 生成（POST）
    redeem/[token]/           # 顧客向け住所登録（入力→確認→完了）
  lib/
    token.ts                  # 256bit トークン生成・SHA-256
    validation/address.ts     # 住所スキーマ
    redeem/service.ts         # 住所登録のサーバー処理（依存注入でテスト可能）
    auth/                     # requireAdmin（サーバー側権限検証）
    supabase/                 # セッション用クライアント / service role クライアント（server-only）
    qr.ts, pdf.ts, logger.ts, rate-limit.ts, format.ts
tests/
  unit/                       # 純粋ロジック・サーバーアクション（モック）
  db/                         # 実 PostgreSQL で関数・同時実行・RLS
docs/                         # 計画・環境変数・デプロイ・運用・セキュリティ
```

## 4. データベース設計の要点

- 指示書の `qrcodeid` は `qr_code_id` と解釈。
- 追加テーブル: `admin_users`（管理者の許可リスト）、`private.rate_limits`（レート制限、API 非公開スキーマ）。
- `qr_codes.serial_no`（表示用識別番号 `QR-000001`）を追加。トークンとは無関係の連番で、URL には含めない。
- 状態整合性を CHECK 制約で保証（例: `status='used'` なら `used_at` 必須、`revoked` なら `revoked_at/by` 必須）。
- `shipping_addresses.qr_code_id`・`shipments.qr_code_id` に UNIQUE（QR 1件につき住所最大1件の最終防衛線）。
- `audit_logs` は追記専用（UPDATE/DELETE をトリガーで拒否）。metadata には識別番号・変更項目名のみ。
- 発送状態は `shipments` で独立管理。住所登録時に `pending` の行を同一トランザクションで作成。

## 5. セキュリティ設計の要点

- 全テーブル RLS 有効。`anon` には一切の権限なし。`authenticated` は `is_admin()` が真の場合のみ SELECT 可。
- 書き込みはすべて `SECURITY DEFINER` 関数経由。管理者用関数は内部で `is_admin()` を検証し、実行者を `auth.uid()` から取得（クライアントから実行者IDを受け取らない）。
- 顧客の住所登録関数・トークン照会関数・レート制限関数は `service_role` のみ実行可。サーバーアクションからのみ呼び出す。
- `token_hash` 列は管理者にも SELECT させない（列権限）。
- トークン: `crypto.randomBytes(32)` → base64url（43文字）。DB には SHA-256 hex のみ保存。
- `/redeem/*`: `Referrer-Policy: no-referrer`、`no-store`、`noindex`、外部スクリプトなし。
- ロガーはトークン形式・個人情報キーを自動マスク。
- レート制限は DB ベース（サーバーレスの複数インスタンスでも有効）。IP は秘密ソルト付きハッシュで保持。

## 6. 実装順序

指示書のフェーズ 2〜9 の順。各フェーズでテストを実行する。
