# デプロイ手順

構成: **静的サイト（Xserver 共用サーバー）＋ Supabase（DB・認証）**
デモ: **GitHub Pages（Supabase なし。データはブラウザ内のみ）**

> **現状:** 実際の Supabase・Xserver・GitHub には**まだ接続・デプロイしていません**。以下は構築手順です。

```
[ブラウザ] ──静的ファイル──▶ Xserver（HTML/CSS/JS を配信するだけ）
    │
    └──API（HTTPS）──▶ Supabase（DB 関数で権限検証・トランザクション・入力検証・レート制限）
```

---

## A. デモ（GitHub Pages）

Supabase の準備なしで、画面と業務の流れを試せます。

1. GitHub に新しいリポジトリを作成し、このプロジェクトを push する。

```bash
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
```

```bash
git push -u origin main
```

2. GitHub のリポジトリ画面で **Settings → Pages → Build and deployment → Source** を **「GitHub Actions」** にする。
3. 以後、`main` に push するたびに `.github/workflows/demo-pages.yml` が
   テスト → デモのビルド → 公開 を自動で行う（Actions タブで進行状況を確認）。
4. 公開 URL: `https://<ユーザー名>.github.io/<リポジトリ名>/admin/`
   ログイン画面の「デモ用アカウント → 入力する」でログインできる。

**デモの制約**

- データは閲覧しているブラウザの中だけに保存される（他の人・他の端末とは共有されない）。
- そのため、**スマホで QR を読み取ってもデモのデータは見えない**。顧客画面は、発行画面の「顧客画面を開く（デモ）」から同じブラウザで試す。
- 画面右上「デモデータをリセット」で初期状態に戻せる。
- リポジトリを Private にした場合、GitHub Pages の公開可否はプランによる。

プッシュ・プルリクエストのたびに `.github/workflows/ci.yml` がテスト（実 PostgreSQL を含む）・型チェック・Lint・ビルドを実行する。

---

## B. 本番（Supabase ＋ Xserver）

### 1. Supabase プロジェクト

1. Supabase で新規プロジェクトを作成（リージョン: Tokyo 推奨）。
2. **Authentication → Sign In / Providers**: 「Allow new users to sign up」を **OFF**。Email 以外のプロバイダーは無効。
3. **Authentication → URL Configuration**: Site URL を本番サイトの URL に設定。
4. **Project Settings → Data API**: Exposed schemas が `public` のみであることを確認（`private` を公開しない）。
5. **Project Settings → API Keys**: URL と **Publishable key** を控える（Secret key は使わない）。

### 2. マイグレーション

`supabase/migrations/` の SQL を**ファイル名順に**適用します。

Supabase CLI を使う場合:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <project-ref>
```

```bash
npx supabase db push
```

CLI を使わない場合は SQL Editor に `..._schema.sql` → `..._functions.sql` → `..._security.sql` → `..._static_hosting.sql` の順で貼り付けて実行。
適用後、**Advisors → Security Advisor** で警告がないことを確認。

### 3. 最初の管理者

1. **Authentication → Users → Add user → Create new user**（Auto Confirm ON、強固なパスワード）。
2. SQL Editor で管理者として登録:

```sql
insert into public.admin_users (user_id, display_name)
select id, '管理者名' from auth.users where email = 'admin@your-company.example';
```

### 4. ビルド

1. `.env.example` を `.env.production.local` にコピーし、Supabase の URL と Publishable key を設定。
2. ビルド:

```bash
npm ci
```

```bash
npm run build:xserver
```

`out/` フォルダに公開用ファイル一式（`.htaccess` を含む）ができる。

### 5. Xserver へアップロード

1. Xserver のサーバーパネルで対象ドメインの **SSL 設定（無料独自 SSL）** を有効にする。
2. FTP ソフト（FileZilla 等）またはファイルマネージャーで、`out/` の**中身**を
   `/<ドメイン>/public_html/` にアップロードする。
   - `.htaccess` は隠しファイルのため、FTP ソフトで「隠しファイルを表示」を有効にしてアップロード漏れがないか確認する。
   - サブディレクトリ（例 `public_html/delivery/`）に置く場合は、ビルド前に `NEXT_PUBLIC_BASE_PATH=/delivery` を設定する。
3. `https://<ドメイン>/admin/` を開いてログインできることを確認。

> QR に印刷される URL は「管理画面を開いているサイトの URL」（または `NEXT_PUBLIC_SITE_URL`）で決まります。
> **QR を配布し始めた後にドメインや配置ディレクトリを変えると、配布済みの QR が使えなくなります。**

### 6. 本番での確認チェックリスト

- [ ] `/admin/` に未ログインでアクセス → ログイン画面に移動する
- [ ] admin_users 未登録のユーザーでログイン → 拒否される
- [ ] QR を 1 件発行 → 画面表示・印刷・PDF ダウンロードができる
- [ ] **印刷した QR を実機のスマートフォン（iPhone / Android 各1台以上）で読み取る** → 住所入力画面が開く
- [ ] 住所登録 → 完了。もう一度読み取ると「登録済み」
- [ ] 発送管理で発送済みにする → 操作履歴に記録される
- [ ] 検証用 QR は無効化しておく
- [ ] ヘッダー確認（`.htaccess` が効いているか）:

```bash
curl -sI https://<ドメイン>/redeem/
```

  `Referrer-Policy: no-referrer`、`Content-Security-Policy`、`Strict-Transport-Security` が付いていること

- [ ] レート制限の確認: Supabase のログ（API Gateway）で `cf-connecting-ip` / `x-forwarded-for` ヘッダーが渡っていることを確認（`private.client_key` が利用。渡っていない場合は全員が同じ制限枠を共有するため上限値の調整が必要）

### 7. 更新（再デプロイ）

`npm run build:xserver` → `out/` の中身を上書きアップロード。古いファイル（`_next/static/` 内）は残っていても問題ない。
DB の変更がある場合は、先にマイグレーションを適用してからアップロードする。

---

## C. ローカル開発

| 目的 | コマンド |
|---|---|
| デモモードで開発（Supabase 不要） | `npm run dev:demo` |
| エミュレーター（実 PostgreSQL＋Supabase API の模倣）で開発 | `npm run emulator` と、別ターミナルで `npm run dev`（事前に `scripts/local-emulator/env.local.example` を `.env.local` にコピー） |
| テスト | `npm test` |

エミュレーターのテスト管理者は `scripts/local-emulator/seed.json` を参照。
エミュレーターは Supabase の API を部分的に模倣したもので、最終確認は実際の Supabase で行うこと。
