-- QRコード配送管理システム: 業務処理用の DB 関数
-- 各関数は 1 回の呼び出しが 1 トランザクションになる（PostgREST の RPC はリクエスト単位でトランザクション）。
-- 関数内で例外が発生した場合、その呼び出しで行った変更はすべてロールバックされる。

-- ---------------------------------------------------------------------------
-- 管理者判定（RLS ポリシーと管理者用関数で共通利用）
-- ---------------------------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and is_active
  );
$$;

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- QRコード発行（管理者）: トークンはアプリサーバーで生成し、ハッシュのみを受け取る
-- ---------------------------------------------------------------------------
create function public.issue_qr_code(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_row public.qr_codes%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023';
  end if;

  insert into public.qr_codes (token_hash, created_by)
  values (p_token_hash, v_uid)
  returning * into v_row;

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  values ('admin', v_uid, 'qr.issue', 'qr_code', v_row.id, jsonb_build_object('serial_no', v_row.serial_no));

  return jsonb_build_object(
    'id', v_row.id,
    'serial_no', v_row.serial_no,
    'created_at', v_row.created_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 印刷用: 発行直後のトークンが当該 QR のものであり、未使用であることを確認（管理者）
-- ---------------------------------------------------------------------------
create function public.verify_qr_token(p_qr_code_id uuid, p_token_hash text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return exists (
    select 1 from public.qr_codes
    where id = p_qr_code_id and token_hash = p_token_hash and status = 'unused'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- QRコード無効化（管理者）: 未使用のものだけを無効化できる
-- 戻り値: ok / not_found / not_unused
-- ---------------------------------------------------------------------------
create function public.revoke_qr_code(p_qr_code_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_serial bigint;
begin
  update public.qr_codes
     set status = 'revoked', revoked_at = now(), revoked_by = v_uid
   where id = p_qr_code_id and status = 'unused'
  returning serial_no into v_serial;

  if not found then
    if exists (select 1 from public.qr_codes where id = p_qr_code_id) then
      return 'not_unused';
    end if;
    return 'not_found';
  end if;

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  values ('admin', v_uid, 'qr.revoke', 'qr_code', p_qr_code_id, jsonb_build_object('serial_no', v_serial));

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 顧客の住所登録（service_role のみ実行可。アプリサーバーで入力検証済みの値を受け取る）
-- 戻り値: ok / invalid / used / revoked
--
-- 1. トークンハッシュで対象行を特定し FOR UPDATE でロック（同時リクエストはここで直列化）
-- 2. 状態が unused であることを確認
-- 3. QRコードを used に変更
-- 4. 住所・発送(pending)・操作履歴を保存
-- いずれかで例外が起きれば全体がロールバックされる。
-- ---------------------------------------------------------------------------
create function public.redeem_qr_code(
  p_token_hash     text,
  p_recipient_name text,
  p_postal_code    text,
  p_prefecture     text,
  p_city           text,
  p_address_line   text,
  p_building       text,
  p_phone          text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_qr public.qr_codes%rowtype;
  v_address_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return 'invalid';
  end if;

  select * into v_qr from public.qr_codes where token_hash = p_token_hash for update;

  if not found then
    return 'invalid';
  elsif v_qr.status = 'used' then
    return 'used';
  elsif v_qr.status = 'revoked' then
    return 'revoked';
  end if;

  update public.qr_codes
     set status = 'used', used_at = now()
   where id = v_qr.id and status = 'unused';

  if not found then
    -- ロック下では到達しないが、防御的に扱う
    return 'used';
  end if;

  insert into public.shipping_addresses
    (qr_code_id, recipient_name, postal_code, prefecture, city, address_line, building, phone)
  values
    (v_qr.id, p_recipient_name, p_postal_code, p_prefecture, p_city, p_address_line, nullif(p_building, ''), p_phone)
  returning id into v_address_id;

  insert into public.shipments (qr_code_id) values (v_qr.id);

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  values ('customer', null, 'address.register', 'qr_code', v_qr.id, jsonb_build_object('serial_no', v_qr.serial_no));

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 顧客画面表示用: トークンの状態のみを返す（service_role のみ）
-- 戻り値: unused / used / revoked / invalid
-- ---------------------------------------------------------------------------
create function public.get_redeem_status(p_token_hash text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select status from public.qr_codes where token_hash = p_token_hash),
    'invalid'
  );
$$;

-- ---------------------------------------------------------------------------
-- 住所修正（管理者）: 変更された項目名のみを操作履歴に保存（値は保存しない）
-- 戻り値: ok / not_found / no_change
-- ---------------------------------------------------------------------------
create function public.admin_update_address(
  p_qr_code_id     uuid,
  p_recipient_name text,
  p_postal_code    text,
  p_prefecture     text,
  p_city           text,
  p_address_line   text,
  p_building       text,
  p_phone          text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_old public.shipping_addresses%rowtype;
  v_building text := nullif(p_building, '');
  v_changed text[] := '{}';
  v_serial bigint;
begin
  select * into v_old from public.shipping_addresses where qr_code_id = p_qr_code_id for update;
  if not found then
    return 'not_found';
  end if;

  if v_old.recipient_name is distinct from p_recipient_name then v_changed := array_append(v_changed, 'recipient_name'); end if;
  if v_old.postal_code    is distinct from p_postal_code    then v_changed := array_append(v_changed, 'postal_code');    end if;
  if v_old.prefecture     is distinct from p_prefecture     then v_changed := array_append(v_changed, 'prefecture');     end if;
  if v_old.city           is distinct from p_city           then v_changed := array_append(v_changed, 'city');           end if;
  if v_old.address_line   is distinct from p_address_line   then v_changed := array_append(v_changed, 'address_line');   end if;
  if v_old.building       is distinct from v_building       then v_changed := array_append(v_changed, 'building');       end if;
  if v_old.phone          is distinct from p_phone          then v_changed := array_append(v_changed, 'phone');          end if;

  if cardinality(v_changed) = 0 then
    return 'no_change';
  end if;

  update public.shipping_addresses
     set recipient_name = p_recipient_name,
         postal_code    = p_postal_code,
         prefecture     = p_prefecture,
         city           = p_city,
         address_line   = p_address_line,
         building       = v_building,
         phone          = p_phone,
         updated_at     = now(),
         updated_by     = v_uid
   where id = v_old.id;

  select serial_no into v_serial from public.qr_codes where id = p_qr_code_id;

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  values ('admin', v_uid, 'address.update', 'shipping_address', v_old.id,
          jsonb_build_object('serial_no', v_serial, 'qr_code_id', p_qr_code_id, 'changed_fields', to_jsonb(v_changed)));

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- 発送済み登録（管理者）: pending の場合のみ更新（二重登録防止）。QRコードの状態は変更しない。
-- 戻り値: ok / not_found / already_shipped
-- ---------------------------------------------------------------------------
create function public.mark_shipped(p_qr_code_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
  v_shipment_id uuid;
  v_serial bigint;
begin
  update public.shipments
     set status = 'shipped', shipped_at = now(), shipped_by = v_uid, updated_at = now()
   where qr_code_id = p_qr_code_id and status = 'pending'
  returning id into v_shipment_id;

  if not found then
    if exists (select 1 from public.shipments where qr_code_id = p_qr_code_id) then
      return 'already_shipped';
    end if;
    return 'not_found';
  end if;

  select serial_no into v_serial from public.qr_codes where id = p_qr_code_id;

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  values ('admin', v_uid, 'shipment.mark_shipped', 'shipment', v_shipment_id,
          jsonb_build_object('serial_no', v_serial, 'qr_code_id', p_qr_code_id));

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- ダッシュボード集計（管理者）
-- ---------------------------------------------------------------------------
create function public.admin_dashboard_counts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'total',             (select count(*) from public.qr_codes),
    'awaiting_address',  (select count(*) from public.qr_codes where status = 'unused'),
    'awaiting_shipment', (select count(*) from public.shipments where status = 'pending'),
    'shipped',           (select count(*) from public.shipments where status = 'shipped'),
    'revoked',           (select count(*) from public.qr_codes where status = 'revoked')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- レート制限（service_role のみ）: 固定ウィンドウ方式。許可なら true。
-- ---------------------------------------------------------------------------
create function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_key is null or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into private.rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;

  -- 古いウィンドウを確率的に掃除
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;
