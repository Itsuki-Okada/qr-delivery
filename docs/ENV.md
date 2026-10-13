# 環境変数

本構成は静的サイトのため、環境変数は**ビルド時にブラウザ向けコードへ埋め込まれます**。
したがって、ここに設定する値はすべて公開されても問題ない値に限ります。

| 変数 | 必須 | 説明 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 本番○ | Supabase プロジェクト URL（https） |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 本番○ | Publishable key（旧 anon key）。公開前提の鍵。できることは RLS と DB 関数の権限で制限されている |
| `NEXT_PUBLIC_SITE_URL` | 任意 | QR に埋め込む URL のベース。未設定なら管理画面を開いているサイト（＋BASE_PATH）を使う |
| `NEXT_PUBLIC_BASE_PATH` | 任意 | サブディレクトリ配置時のパス（例 `/delivery`）。GitHub Pages のデモでは自動設定 |
| `NEXT_PUBLIC_DEMO_MODE` | — | `npm run build:demo` が自動で `1` に設定。手動設定は不要 |

## 使わないもの（設定してはいけないもの）

- **Secret key / service_role key**：本構成では一切使用しません。ビルド環境にも置かないでください。
- DB の接続文字列・パスワード：バックアップ作業時のみ、作業者の手元で使用します（`docs/OPERATIONS.md`）。

## ファイル

- 本番ビルド：`.env.production.local`（`.env.example` をコピー）
- エミュレーターでのローカル開発：`.env.local`（`scripts/local-emulator/env.local.example` をコピー）
- いずれも `.gitignore` 済み
