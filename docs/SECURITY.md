# セキュリティ設計とテスト対応表

## 1. 構成と信頼境界

```
顧客のスマホ ─┐
              ├─ 静的ファイル取得 ──▶ Xserver（HTML/JS を配るだけ。データ・秘密情報なし）
管理者の PC ──┘
      │
      └─ HTTPS ──▶ Supabase API ──▶ PostgreSQL
                     ├ anon（顧客）      : redeem_status / submit_redeem の 2 関数のみ実行可
                     └ authenticated     : 有効な管理者（admin_users）のみ SELECT 可、管理用関数は内部で is_admin() を検証
```

- 画面（JavaScript）はブラウザで動くため改ざん可能という前提で、**すべての権限判定・検証は DB 側**で行う。
- アプリは Secret key（service_role）を一切使わない。配布物に含まれるのは公開前提の Publishable key のみ。
- 管理画面のログイン確認は画面表示用。回避しても RLS により管理データは取得できない（`tests/db/rls.test.ts`）。

## 2. 要件と実装・テストの対応

| 要件 | 実装 | テスト |
|---|---|---|
| 管理者ログイン / ログアウト | Supabase Auth ＋ `admin_users` 許可リスト | 契約テスト（Supabase 版はエミュレーター経由） |
| 未認証の管理画面アクセス拒否 | 画面: ログイン確認 / データ: RLS・関数内 `is_admin()` | `rls.test.ts`、契約テスト「未ログインでは…拒否」 |
| 管理者の自己登録禁止 | Supabase Auth のサインアップ無効、`admin_users` | 契約テスト「管理者でない Auth ユーザー」 |
| QR 発行（1回1件） | DB `issue_qr_code()` | `redeem.test.ts`、契約テスト |
| 256bit トークン・SHA-256 保存・生成と照合はサーバー側 | DB で `gen_random_bytes(32)` 生成、`private.hash_token` で照合 | `redeem.test.ts`（形式・一意性・生トークン非保存）、`token.test.ts` |
| トークンをログ・Referer に出さない | QR URL を `/redeem/#<token>` とし、`#` 以降はサーバーへ送信されない | `token.test.ts`、ブラウザ検証で Web サーバーのアクセスログに無いことを確認 |
| QR 画像・PDF | ブラウザで `qrcode`・`pdf-lib` により生成 | `qr-pdf.test.ts`（画像をデコードして URL 一致） |
| 住所登録・使用済み化（原子的） | DB `submit_redeem` → `redeem_qr_code`（`FOR UPDATE`・1 トランザクション） | `redeem.test.ts`、`public-api.test.ts` |
| 使用済み・無効化済み・不正トークン拒否 | 同上 | `public-api.test.ts`、契約テスト |
| 同時アクセスの二重登録防止 | 行ロック＋ `qr_code_id` UNIQUE | `redeem.test.ts`（20並列）、`public-api.test.ts`（anon 20並列）、契約テスト（10並列） |
| 保存失敗時のロールバック | 関数内例外で全体ロールバック | `redeem.test.ts`（制約違反・障害注入） |
| 入力値のサーバー側検証 | `submit_redeem` 内で項目ごとに検証＋テーブルの CHECK 制約 | `public-api.test.ts`、契約テスト（画面の検証を回避した送信） |
| 発送済み登録・二重登録防止 | DB `mark_shipped`（`pending` 条件付き更新） | `redeem.test.ts`（10並列）、契約テスト |
| QR 状態と発送状態の独立 | 別テーブル | `redeem.test.ts`、契約テスト |
| 管理者の住所修正・監査 | DB `admin_update_address`（変更項目名のみ記録） | `redeem.test.ts`、契約テスト |
| 無効化（未使用のみ・戻せない） | DB `revoke_qr_code`、CHECK 制約 | `redeem.test.ts`、契約テスト |
| RLS とデータアクセス権限 | `..._security.sql`、`..._static_hosting.sql` | `rls.test.ts`、`public-api.test.ts` |
| レート制限 | DB `check_rate_limit`（IP を秘密ソルト付きハッシュ化） | `public-api.test.ts`（30回/分・10回/10分、生 IP 非保存） |
| 個人情報・トークンをログに出さない | 操作履歴に値を保存しない、`logger.ts` のマスク | `redeem.test.ts`、`logger.test.ts`、契約テスト（コンソール出力の検査） |
| セキュリティヘッダー | Xserver: `.htaccess`、全環境: meta CSP / Referrer | `static-build.test.ts` |
| 秘密情報をクライアントに出さない | Secret key 不使用、本番ビルドからデモ用コードを除去 | ビルド成果物の検索で確認 |

## 3. 検証方法と限界（正直な記録）

| 項目 | 状況 |
|---|---|
| DB（関数・制約・RLS・同時実行・レート制限） | 実 PostgreSQL 18（UTF-8）に Supabase 互換シムを当てて検証。本番 Supabase は PostgreSQL 15/17 |
| Supabase 版の画面ロジック | supabase-js → ローカルエミュレーター → 実 PostgreSQL で契約テストを実行。エミュレーターは PostgREST / GoTrue の一部を模倣したもの。**実際の Supabase では未検証** |
| デモ版 | 静的ビルドを GitHub Pages と同じサブパス構成で配信し、ブラウザで発行→登録→再登録拒否→発送→修正→履歴を確認 |
| レート制限の IP 取得 | Supabase が `cf-connecting-ip` / `x-forwarded-for` を `request.headers` に渡す前提。**実環境での確認が必要**（`docs/DEPLOY.md` チェックリスト） |
| QR の実機読み取り・実際の印刷 | **未実施**。本番チェックリストで実施すること |
| npm audit | `eslint-config-next` 経由の開発用依存に high 判定あり。配布物には含まれない |

## 4. 静的構成で増えたリスクと対策

| リスク | 対策 |
|---|---|
| 管理者のセッションがブラウザ（sessionStorage）に置かれる → XSS で盗まれ得る | 外部スクリプトを読み込まない、CSP で接続先を自サイトと Supabase に限定、React の自動エスケープ、タブを閉じるとセッション消滅。管理者アカウントには MFA を推奨 |
| anon キーで DB 関数を直接呼ばれる | 呼べるのは顧客用 2 関数のみ。トークンは 256bit で推測不可能、入力検証・レート制限は DB 内で実施 |
| Supabase 側の IP ヘッダーが取れない場合、レート制限が全利用者で共有される | 本番確認項目に追加。必要なら上限値を調整 |

## 5. 今後の改善候補

- 管理者の MFA 必須化（Supabase Auth の AAL2 を `is_admin()` で確認）
- CSP の `'unsafe-inline'` を除去（静的書き出しでの nonce 運用は難しいため、ハッシュ方式の検討）
- PDF への日本語フォント埋め込み
