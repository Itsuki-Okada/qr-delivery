# QRコード配送管理システム

商品を受け取る権利を QR コードで管理する Web システムです。

```
管理者: QRコードを発行 → 印刷 → 顧客へ送付
顧客  : QRコードをスマホで読み取り → 配送先住所を入力 → 登録と同時にそのQRコードは使用済み（再登録不可）
管理者: 住所を確認して商品を発送（発送作業は人が行う）→ 管理画面で「発送済み」にする
```

## 構成

- **画面**: Next.js 16（App Router）の静的書き出し。Xserver の共用サーバーに FTP でアップロードするだけで動作
- **データ・認証**: Supabase（PostgreSQL・Auth・RLS）。権限検証・トランザクション・トークン生成と照合・入力検証・レート制限は DB 関数で実行
- **デモ**: Supabase なしでブラウザ内だけで動くデモモードを GitHub Pages で公開（GitHub Actions で自動デプロイ）
- **テスト**: Vitest ＋ 実 PostgreSQL（embedded-postgres、Docker 不要）。GitHub Actions でも実行

## 画面

| パス | 対象 | 内容 |
|---|---|---|
| `/admin/login/` | 管理者 | ログイン |
| `/admin/` | 管理者 | ダッシュボード（発行総数・住所登録待ち・発送待ち・発送済み・無効化） |
| `/admin/qr/new/` | 管理者 | QR コード発行・印刷・PDF・発行履歴 |
| `/admin/qr/` | 管理者 | QR コード一覧（状態での絞り込み、識別番号・発行日検索、無効化） |
| `/admin/addresses/` | 管理者 | 住所一覧・詳細・修正・操作履歴 |
| `/admin/shipments/` | 管理者 | 発送待ち / 発送済み、発送済みにする |
| `/admin/audit/` | 管理者 | 操作履歴 |
| `/redeem/#<token>` | 顧客 | 住所入力 → 確認 → 完了（スマホ最適化） |

## コマンド

```bash
npm install
```

| コマンド | 内容 |
|---|---|
| `npm run dev:demo` | デモモードで開発サーバー（Supabase 不要） |
| `npm test` | 全テスト（ユニット・契約テスト・実 PostgreSQL の DB テスト） |
| `npm run build:demo` | デモ用の静的サイトを `out/` に作成 |
| `npm run build:xserver` | 本番用の静的サイトを `out/` に作成（`.htaccess` 付き。`.env.production.local` が必要） |
| `npm run emulator` | ローカル検証用の Supabase エミュレーター（開発専用） |
| `npm run typecheck` / `npm run lint` | 型チェック / Lint |

## ドキュメント

- [docs/DEPLOY.md](docs/DEPLOY.md) — GitHub Pages デモ、Supabase ＋ Xserver 本番の手順とチェックリスト
- [docs/ENV.md](docs/ENV.md) — 環境変数
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — 運用マニュアル（日常業務・管理者管理・バックアップと復元）
- [docs/SECURITY.md](docs/SECURITY.md) — セキュリティ設計、要件とテストの対応表、検証の限界
- [docs/PLAN.md](docs/PLAN.md) — 実装計画と構成変更の記録

## ディレクトリ

```
supabase/migrations/     スキーマ・DB 関数・RLS（マイグレーション）
src/app/admin/           管理画面
src/app/redeem/          顧客向け住所登録
src/lib/backend/         データ操作の窓口（supabase.ts: 本番 / demo.ts: デモ / types.ts: 共通の型）
src/lib/                 トークン・入力検証・QR/PDF・ロガー
tests/db/                実 PostgreSQL での DB テスト（同時実行・ロールバック・RLS・レート制限）
tests/contract/          Supabase 版とデモ版が同じ業務ルールを満たすかの共通テスト
tests/unit/              ユニットテスト
scripts/build.mjs        Xserver / デモ用ビルド
scripts/local-emulator/  ローカル検証用 Supabase エミュレーター（開発専用）
.github/workflows/       CI（テスト）と GitHub Pages へのデモ公開
```
