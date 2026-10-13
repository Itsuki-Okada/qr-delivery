-- 静的ホスティング（Xserver 共用サーバー等）対応
-- アプリサーバーを持たないため、トークンの生成・照合・入力検証・レート制限を DB 関数（サーバー側）で行い、
-- 顧客のブラウザからは anon ロールでこれらの関数だけを呼べるようにする。
-- 秘密鍵（service_role / secret key）はアプリから一切使用しない。

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 内部設定（レート制限キー用の秘密ソルト。API 非公開スキーマ）
-- ---------------------------------------------------------------------------
create table private.settings (
  id              boolean primary key default true check (id),
  rate_limit_salt text not null
);
insert into private.settings (rate_limit_salt) values (encode(extensions.gen_random_bytes(32), 'hex'));
revoke all on private.settings from public;

-- ---------------------------------------------------------------------------
-- 内部ヘルパー
-- ---------------------------------------------------------------------------
create function private.hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create function private.is_valid_token(p_token text) returns boolean
language sql immutable set search_path = '' as $$
  select p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43}$';
$$;

-- リクエスト元 IP を秘密ソルト付きでハッシュしたレート制限キー（生の IP は保存しない）。
-- Supabase の API ゲートウェイが付与するヘッダーを PostgREST が request.headers に設定する。
create function private.client_key(p_scope text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text;
begin
  v_ip := coalesce(
    nullif(v_headers ->> 'cf-connecting-ip', ''),
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
    'unknown'
  );
  return p_scope || ':' || encode(sha256(convert_to((select rate_limit_salt from private.settings) || v_ip, 'UTF8')), 'hex');
end;
$$;

-- ---------------------------------------------------------------------------
-- QRコード発行（管理者）: トークンを DB で暗号学的乱数から生成し、ハッシュのみ保存する。
-- 生のトークンは戻り値で発行した管理者に 1 度だけ返す（DB には残らない）。
-- ---------------------------------------------------------------------------
drop function public.issue_qr_code(text);

create function public.issue_qr_code() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_token text;
  v_row public.qr_codes%rowtype;
begin
  -- 32 バイト = 256 ビット。base64url（パディングなし）で 43 文字
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.qr_codes (token_hash, created_by)
  values (private.hash_token(v_token), v_uid)
  returning * into v_row;

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  values ('admin', v_uid, 'qr.issue', 'qr_code', v_row.id, jsonb_build_object('serial_no', v_row.serial_no));

  return jsonb_build_object(
    'id', v_row.id,
    'serial_no', v_row.serial_no,
    'created_at', v_row.created_at,
    'token', v_token
  );
end;
$$;

-- 静的構成では PDF をブラウザで生成するため不要
drop function public.verify_qr_token(uuid, text);
-- ハッシュを受け取る旧関数は、トークンを受け取る redeem_status に置き換える
drop function public.get_redeem_status(text);

-- ---------------------------------------------------------------------------
-- 顧客: QR の状態確認（anon から実行可）
-- 戻り値: unused / used / revoked / invalid / rate_limited
-- ---------------------------------------------------------------------------
create function public.redeem_status(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.check_rate_limit(private.client_key('redeem-view'), 30, 60) then
    return 'rate_limited';
  end if;
  if not private.is_valid_token(p_token) then
    return 'invalid';
  end if;
  return coalesce(
    (select status from public.qr_codes where token_hash = private.hash_token(p_token)),
    'invalid'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 顧客: 住所登録（anon から実行可）
-- 入力値をサーバー側で検証し、問題なければ redeem_qr_code（ロック・状態確認・used 化・住所保存を
-- 1 トランザクションで実行）を呼ぶ。
-- 戻り値: {"status": ok|invalid|used|revoked|rate_limited|validation, "fields": [...]}
-- ---------------------------------------------------------------------------
create function public.submit_redeem(
  p_token          text,
  p_recipient_name text,
  p_postal_code    text,
  p_prefecture     text,
  p_city           text,
  p_address_line   text,
  p_building       text,
  p_phone          text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- 制御文字・ゼロ幅文字・双方向制御文字
  c_forbidden constant text := '[\u0001-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]';
  v_name     text := btrim(coalesce(p_recipient_name, ''));
  v_postal   text := btrim(coalesce(p_postal_code, ''));
  v_pref     text := btrim(coalesce(p_prefecture, ''));
  v_city     text := btrim(coalesce(p_city, ''));
  v_line     text := btrim(coalesce(p_address_line, ''));
  v_building text := btrim(coalesce(p_building, ''));
  v_phone    text := btrim(coalesce(p_phone, ''));
  v_fields   text[] := '{}';
  v_result   text;
begin
  if not public.check_rate_limit(private.client_key('redeem-submit'), 10, 600) then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  if not private.is_valid_token(p_token) then
    return jsonb_build_object('status', 'invalid');
  end if;

  if char_length(v_name) not between 1 and 100 or v_name ~ c_forbidden then v_fields := array_append(v_fields, 'recipient_name'); end if;
  if v_postal !~ '^[0-9]{3}-[0-9]{4}$' then v_fields := array_append(v_fields, 'postal_code'); end if;
  if v_pref <> all (array[
    '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
    '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
    '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県',
    '静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県',
    '奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県',
    '徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県',
    '熊本県','大分県','宮崎県','鹿児島県','沖縄県']) then v_fields := array_append(v_fields, 'prefecture'); end if;
  if char_length(v_city) not between 1 and 100 or v_city ~ c_forbidden then v_fields := array_append(v_fields, 'city'); end if;
  if char_length(v_line) not between 1 and 200 or v_line ~ c_forbidden then v_fields := array_append(v_fields, 'address_line'); end if;
  if char_length(v_building) > 200 or v_building ~ c_forbidden then v_fields := array_append(v_fields, 'building'); end if;
  if v_phone !~ '^0[0-9]{9,10}$' then v_fields := array_append(v_fields, 'phone'); end if;

  if cardinality(v_fields) > 0 then
    return jsonb_build_object('status', 'validation', 'fields', to_jsonb(v_fields));
  end if;

  v_result := public.redeem_qr_code(
    private.hash_token(p_token), v_name, v_postal, v_pref, v_city, v_line, v_building, v_phone);
  return jsonb_build_object('status', v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- 権限
-- ---------------------------------------------------------------------------
revoke all on function private.hash_token(text), private.is_valid_token(text), private.client_key(text) from public;
revoke execute on function public.issue_qr_code(), public.redeem_status(text),
  public.submit_redeem(text, text, text, text, text, text, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.issue_qr_code(), public.redeem_status(text), public.submit_redeem(text, text, text, text, text, text, text, text) from anon, authenticated, service_role';
    execute 'grant execute on function public.issue_qr_code() to authenticated';
    execute 'grant execute on function public.redeem_status(text) to anon, authenticated';
    execute 'grant execute on function public.submit_redeem(text, text, text, text, text, text, text, text) to anon, authenticated';
  end if;
end $$;
