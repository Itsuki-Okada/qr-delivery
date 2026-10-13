-- テスト用: Supabase が提供するロール・auth スキーマ・既定権限をローカル PostgreSQL 上で再現する。
-- 本番の Supabase ではこれらは既に存在するため、このファイルは適用しない。
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema auth;
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create table auth.users (
  id    uuid primary key,
  email text
);

-- Supabase の auth.uid() と同じ判定ロジック
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase の public スキーマ既定権限（マイグレーション側で取り消せることを検証するため再現する）
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
