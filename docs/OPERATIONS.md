# 運用マニュアル

## 1. 日常業務の流れ

| # | 担当 | 操作 | 画面 |
|---|---|---|---|
| 1 | 管理者 | ログイン | `/admin/login` |
| 2 | 管理者 | 「QRコードを新規発行」を押す（1回1件） | QRコード発行 |
| 3 | 管理者 | 「印刷する」または「印刷用PDFをダウンロード」 | 同上 |
| 4 | 管理者 | 印刷物を顧客へ送付（識別番号を控えておく） | — |
| 5 | 顧客 | QR をスマホで読み取り、住所を入力 → 確認 → 登録 | `/redeem/...` |
| 6 | 管理者 | 発送待ちの一覧で住所を確認し、商品を梱包・発送 | 発送管理 |
| 7 | 管理者 | 「発送済みにする」を押す（日時・操作者が記録される） | 発送管理 |

### QR コード発行時の注意

- QR コードは**発行した画面でのみ**表示・印刷できます（DB にはハッシュしか保存しないため再表示不可）。
- 印刷に失敗した・画面を閉じてしまった場合は、そのコードを**無効化してから新しく発行**してください。
- 印刷物には QR コードと識別番号のみが載ります。顧客名などは手書き・別紙で管理してください。
- 印刷サイズは QR 部分が約 50mm 四方です。縮小印刷しないでください（「実際のサイズ」で印刷）。
- PDF 内の文字は英数字のみです（日本語の案内文が必要な場合はブラウザの「印刷する」を使用）。
- QR の URL は `https://<サイト>/redeem/#<ランダムな文字列>` 形式です。`#` 以降はサーバーに送信されないため、Xserver のアクセスログに残りません。

## 2. よくある対応

| 状況 | 対応 |
|---|---|
| 顧客が住所を間違えた / 引っ越した | 住所管理 → 該当コード → 修正。修正者・日時・変更項目が操作履歴に残る |
| 顧客が「登録済み」と表示される | 既に誰かが登録済み。住所管理で登録日時・内容を確認し、顧客本人に確認 |
| QR を紛失した / 誤送付した | 未使用なら QR コード一覧 → 無効化 → 新規発行して再送付 |
| 誤って発送済みにした | 通常操作では戻せない（監査のため）。下記「データ修正」を参照 |
| 顧客がアクセス集中エラーになる | 同一 IP から短時間に多数アクセスした場合の制限（DB 関数で判定）。10分程度待って再試行を案内 |
| 管理画面で毎回ログインを求められる | 仕様。ログイン状態はタブを閉じると消える（共用 PC での残存防止） |

## 3. 管理者アカウント

- **追加**: Supabase の Authentication → Users でユーザー作成 → `admin_users` に登録（`docs/DEPLOY.md` 手順3）。
- **停止**: 退職者などは削除せず無効化する（操作履歴の参照整合性を保つため）。

```sql
update public.admin_users set is_active = false where user_id = '<user-id>';
```

  あわせて Authentication → Users で該当ユーザーを Ban / パスワードリセット。
- パスワードは 12 文字以上を推奨。Supabase の MFA（TOTP）を有効にすることを推奨。

## 4. データ修正（例外対応）

通常の画面では「使用済み → 未使用」「発送済み → 未発送」への変更はできません。やむを得ず修正する場合は、
Supabase の SQL Editor で**2名以上で確認しながら**実施し、理由を社内記録に残してください。
`audit_logs` は追記専用のため、修正内容は別途記録します。

## 5. バックアップと復元

### 5-1. 自動バックアップ（推奨）

- Supabase Pro プラン以上: 日次バックアップが自動取得されます（Database → Backups）。
- 重要度が高い場合は **Point-in-Time Recovery（PITR）** アドオンを有効化します。
- 復元はダッシュボードの Backups 画面から実行します（プロジェクト全体が復元時点に戻る点に注意）。

### 5-2. 手動バックアップ（定期的なエクスポート）

接続文字列は Project Settings → Database → Connection string（Session pooler / 直接接続）から取得します。
バックアップファイルには**個人情報が含まれる**ため、暗号化した保管場所に置き、保管期間を定めてください。

スキーマとデータを取得:

```bash
pg_dump "$SUPABASE_DB_URL" --schema=public --schema=private --format=custom --no-owner --no-privileges --file=qr-delivery-$(date +%Y%m%d).dump
```

認証ユーザー（管理者）も含める場合は `--schema=auth` を追加するか、Supabase CLI を使用:

```bash
npx supabase db dump --db-url "$SUPABASE_DB_URL" --data-only -f data.sql
```

### 5-3. 復元手順（新しいプロジェクトへ）

1. 新しい Supabase プロジェクトを作成し、`docs/DEPLOY.md` の手順 1〜2（マイグレーション適用）まで実施。
2. 管理者ユーザーを Auth に再作成するか、`auth.users` を含むダンプから復元（`admin_users` は `auth.users` を参照するため先に必要）。
3. データを投入（追記専用トリガーを一時的に無効化するため `session_replication_role` を使用）:

```bash
psql "$NEW_DB_URL" -c "set session_replication_role = replica;" -f data.sql
```

   custom 形式の場合:

```bash
pg_restore --dbname="$NEW_DB_URL" --data-only --disable-triggers --no-owner qr-delivery-YYYYMMDD.dump
```

4. 件数を確認:

```sql
select status, count(*) from public.qr_codes group by status;
select status, count(*) from public.shipments group by status;
select count(*) from public.shipping_addresses;
```

5. `serial_no` の採番を復元後の最大値に合わせる:

```sql
select setval(pg_get_serial_sequence('public.qr_codes', 'serial_no'), (select coalesce(max(serial_no), 1) from public.qr_codes));
```

6. `.env.production.local` を新プロジェクトの URL・Publishable key に変更して `npm run build:xserver` → Xserver へ再アップロード。サイトのドメイン・配置ディレクトリは変えないこと（配布済み QR が使えなくなる）。
7. 未使用の QR を 1 件発行して、住所登録から発送済みまでの動作確認を行い、その QR は無効化する。

**復元訓練**を半年に一度程度、別プロジェクトに対して実施することを推奨します。

## 6. 個人情報の取り扱い

- 住所・電話番号はアプリのログ・操作履歴に保存されません（DB の `shipping_addresses` のみ）。
- 発送完了後の保管期間を社内規程で定め、期限を過ぎたデータは削除または匿名化してください（削除は SQL で実施。`qr_codes` / `audit_logs` は残す）。
