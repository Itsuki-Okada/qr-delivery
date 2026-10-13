-- QRコード配送管理システム: RLS と権限
-- 方針:
--   anon          : 何もできない（顧客の操作はアプリサーバー経由で service_role が行う）
--   authenticated : 有効な管理者（is_admin()）のみ SELECT 可。書き込みは管理者用関数経由のみ。
--   service_role  : 顧客の住所登録・トークン照会・レート制限の関数のみ使用する。

-- ---------------------------------------------------------------------------
-- 非公開スキーマ
-- ---------------------------------------------------------------------------
revoke all on schema private from public;
revoke all on all tables in schema private from public;
revoke all on all functions in schema private from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS 有効化
-- ---------------------------------------------------------------------------
alter table public.admin_users        enable row level security;
alter table public.qr_codes           enable row level security;
alter table public.shipping_addresses enable row level security;
alter table public.shipments          enable row level security;
alter table public.audit_logs         enable row level security;

-- ---------------------------------------------------------------------------
-- テーブル権限（Supabase の既定 GRANT を取り消し、必要最小限だけ付与）
-- ---------------------------------------------------------------------------
revoke all on public.admin_users, public.qr_codes, public.shipping_addresses,
              public.shipments, public.audit_logs, public.admin_qr_overview
  from public, anon, authenticated;

grant select on public.admin_users, public.shipping_addresses, public.shipments,
                public.audit_logs, public.admin_qr_overview
  to authenticated;

-- token_hash 列は管理者にも見せない
grant select (id, serial_no, status, created_at, created_by, used_at, revoked_at, revoked_by)
  on public.qr_codes to authenticated;

-- ---------------------------------------------------------------------------
-- RLS ポリシー（SELECT のみ。INSERT/UPDATE/DELETE ポリシーは作らない＝直接書き込み不可）
-- ---------------------------------------------------------------------------
create policy admin_users_select_admin on public.admin_users
  for select to authenticated using (public.is_admin());

create policy qr_codes_select_admin on public.qr_codes
  for select to authenticated using (public.is_admin());

create policy shipping_addresses_select_admin on public.shipping_addresses
  for select to authenticated using (public.is_admin());

create policy shipments_select_admin on public.shipments
  for select to authenticated using (public.is_admin());

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 関数の実行権限
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.issue_qr_code(text) to authenticated;
grant execute on function public.verify_qr_token(uuid, text) to authenticated;
grant execute on function public.revoke_qr_code(uuid) to authenticated;
grant execute on function public.admin_update_address(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.mark_shipped(uuid) to authenticated;
grant execute on function public.admin_dashboard_counts() to authenticated;

grant execute on function public.redeem_qr_code(text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.get_redeem_status(text) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- 今後追加される関数が既定で anon / authenticated に公開されないようにする
alter default privileges in schema public revoke execute on functions from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema public revoke execute on functions from anon, authenticated';
  end if;
end $$;
