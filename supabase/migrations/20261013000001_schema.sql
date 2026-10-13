-- QRコード配送管理システム: スキーマ定義
-- テーブル・制約・インデックスのみを定義する。業務処理は functions、権限は security マイグレーションで定義する。

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- 管理者（Supabase Auth のユーザーのうち、ここに登録された者だけが管理者）
-- ---------------------------------------------------------------------------
create table public.admin_users (
  user_id      uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 100),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- QRコード
-- ---------------------------------------------------------------------------
create table public.qr_codes (
  id          uuid primary key default gen_random_uuid(),
  -- 表示用の識別番号（QR-000001）。トークンとは無関係で、URL には含めない。
  serial_no   bigint generated always as identity unique,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status      text not null default 'unused' check (status in ('unused', 'used', 'revoked')),
  created_at  timestamptz not null default now(),
  created_by  uuid not null references public.admin_users (user_id) on delete restrict,
  used_at     timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid references public.admin_users (user_id) on delete restrict,
  constraint qr_codes_status_consistency check (
    (status = 'unused'  and used_at is null     and revoked_at is null     and revoked_by is null)
 or (status = 'used'    and used_at is not null and revoked_at is null     and revoked_by is null)
 or (status = 'revoked' and used_at is null     and revoked_at is not null and revoked_by is not null)
  )
);

create index qr_codes_status_created_at_idx on public.qr_codes (status, created_at desc);
create index qr_codes_created_at_idx on public.qr_codes (created_at desc);

-- ---------------------------------------------------------------------------
-- 配送先住所（QRコード1件につき最大1件）
-- ---------------------------------------------------------------------------
create table public.shipping_addresses (
  id             uuid primary key default gen_random_uuid(),
  qr_code_id     uuid not null unique references public.qr_codes (id) on delete restrict,
  recipient_name text not null check (char_length(recipient_name) between 1 and 100 and recipient_name = btrim(recipient_name)),
  postal_code    text not null check (postal_code ~ '^[0-9]{3}-[0-9]{4}$'),
  prefecture     text not null check (prefecture in (
    '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
    '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
    '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県',
    '静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県',
    '奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県',
    '徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県',
    '熊本県','大分県','宮崎県','鹿児島県','沖縄県')),
  city           text not null check (char_length(city) between 1 and 100 and city = btrim(city)),
  address_line   text not null check (char_length(address_line) between 1 and 200 and address_line = btrim(address_line)),
  building       text check (building is null or (char_length(building) between 1 and 200 and building = btrim(building))),
  -- 数字のみで保存（例: 09012345678）
  phone          text not null check (phone ~ '^0[0-9]{9,10}$'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.admin_users (user_id) on delete restrict
);

create index shipping_addresses_created_at_idx on public.shipping_addresses (created_at desc);

-- ---------------------------------------------------------------------------
-- 発送（QRコードの使用状態とは独立して管理）
-- ---------------------------------------------------------------------------
create table public.shipments (
  id          uuid primary key default gen_random_uuid(),
  qr_code_id  uuid not null unique references public.qr_codes (id) on delete restrict,
  status      text not null default 'pending' check (status in ('pending', 'shipped')),
  shipped_at  timestamptz,
  shipped_by  uuid references public.admin_users (user_id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint shipments_status_consistency check (
    (status = 'pending' and shipped_at is null     and shipped_by is null)
 or (status = 'shipped' and shipped_at is not null and shipped_by is not null)
  )
);

create index shipments_status_created_at_idx on public.shipments (status, created_at);

-- ---------------------------------------------------------------------------
-- 操作履歴（追記専用。住所・電話番号・トークン・認証情報は保存しない）
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_type  text not null check (actor_type in ('admin', 'customer')),
  -- 管理者操作は管理者ID。顧客操作は NULL（顧客アカウントは存在しない）。
  actor_id    uuid,
  action      text not null check (action in (
    'qr.issue', 'qr.revoke', 'address.register', 'address.update', 'shipment.mark_shipped')),
  entity_type text not null check (entity_type in ('qr_code', 'shipping_address', 'shipment')),
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  metadata    jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  constraint audit_logs_actor_consistency check (
    (actor_type = 'admin' and actor_id is not null) or (actor_type = 'customer' and actor_id is null)
  )
);

create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create function private.audit_logs_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function private.audit_logs_append_only();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function private.audit_logs_append_only();

-- ---------------------------------------------------------------------------
-- レート制限（API 非公開スキーマ。key は秘密ソルト付きハッシュで、生の IP は保存しない）
-- ---------------------------------------------------------------------------
create table private.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 1,
  primary key (key, window_start)
);

create index rate_limits_window_start_idx on private.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- 管理画面用の一覧ビュー（security_invoker により呼び出し元の RLS が適用される）
-- ---------------------------------------------------------------------------
create view public.admin_qr_overview with (security_invoker = true) as
select
  q.id,
  q.serial_no,
  q.status,
  q.created_at,
  q.created_by,
  q.used_at,
  q.revoked_at,
  q.revoked_by,
  a.created_at as address_registered_at,
  s.status     as shipment_status,
  s.shipped_at,
  s.shipped_by
from public.qr_codes q
left join public.shipping_addresses a on a.qr_code_id = q.id
left join public.shipments s on s.qr_code_id = q.id;
