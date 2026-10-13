import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { toRpcArgs, type Address, type AddressField } from "@/lib/validation/address";
import {
  NotAuthorizedError,
  PAGE_SIZE,
  type Admin,
  type AddressListItem,
  type AddressRow,
  type AuditLogRow,
  type Backend,
  type DashboardCounts,
  type IssuedQr,
  type QrOverviewRow,
  type RedeemStatus,
  type RedeemSubmitResult,
} from "./types";

// ブラウザから Supabase を直接呼ぶ実装。
// 権限の判定はすべて DB 側（RLS・SECURITY DEFINER 関数内の is_admin()）で行われ、
// この層のチェックは画面表示のためのものに過ぎない。

const OVERVIEW_COLUMNS =
  "id, serial_no, status, created_at, created_by, used_at, revoked_at, revoked_by, address_registered_at, shipment_status, shipped_at, shipped_by";
const ADDRESS_COLUMNS =
  "id, qr_code_id, recipient_name, postal_code, prefecture, city, address_line, building, phone, created_at, updated_at, updated_by";
const AUDIT_COLUMNS = "id, actor_type, actor_id, action, entity_type, entity_id, created_at, metadata";

const GENERIC_LOGIN_ERROR = "メールアドレスまたはパスワードが正しくありません。";

interface PgError {
  code?: string;
  message?: string;
}

function fail(context: string, error: PgError): never {
  // 42501 = DB 関数内の forbidden / 権限不足
  if (error.code === "42501" || error.code === "PGRST301") throw new NotAuthorizedError();
  logger.error(`backend.${context}_failed`, { error });
  throw new Error(`request failed (${context})`);
}

const range = (page = 1) => {
  const p = Math.max(1, Math.floor(page));
  return [(p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1] as const;
};
const jstStart = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00+09:00` : null);
const jstEnd = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59.999+09:00` : null);

export function createSupabaseBackend(supabase: SupabaseClient): Backend {
  async function requireSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new NotAuthorizedError();
  }

  async function addressesFor(qrIds: string[]): Promise<Map<string, AddressRow>> {
    if (qrIds.length === 0) return new Map();
    const { data, error } = await supabase.from("shipping_addresses").select(ADDRESS_COLUMNS).in("qr_code_id", qrIds);
    if (error) fail("addresses", error);
    return new Map(((data ?? []) as AddressRow[]).map((a) => [a.qr_code_id, a]));
  }

  async function withAddresses(qrs: QrOverviewRow[]): Promise<AddressListItem[]> {
    const addresses = await addressesFor(qrs.map((q) => q.id));
    return qrs.flatMap((qr) => {
      const address = addresses.get(qr.id);
      return address ? [{ qr, address }] : [];
    });
  }

  async function getQrOverview(id: string): Promise<QrOverviewRow | null> {
    await requireSession();
    const { data, error } = await supabase.from("admin_qr_overview").select(OVERVIEW_COLUMNS).eq("id", id).maybeSingle();
    if (error) fail("qr_detail", error);
    return data as QrOverviewRow | null;
  }

  async function getCurrentAdmin(): Promise<Admin | null> {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return null;
    // getUser は Auth サーバーでトークンを検証する（失効・改ざんを検出）
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return null;
    const { data, error } = await supabase
      .from("admin_users")
      .select("user_id, display_name, is_active")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error || !data?.is_active) return null;
    return { id: data.user_id, email: userData.user.email ?? null, displayName: data.display_name };
  }

  return {
    mode: "supabase",

    getCurrentAdmin,

    async signIn(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        if (error?.status === 429) return { ok: false, message: "試行回数が多すぎます。しばらく時間をおいてから再度お試しください。" };
        return { ok: false, message: GENERIC_LOGIN_ERROR };
      }
      const admin = await getCurrentAdmin();
      if (!admin) {
        // Supabase Auth のユーザーでも admin_users に有効な管理者として登録されていなければ拒否
        await supabase.auth.signOut();
        return { ok: false, message: GENERIC_LOGIN_ERROR };
      }
      return { ok: true, admin };
    },

    async signOut() {
      await supabase.auth.signOut();
    },

    async getDashboardCounts() {
      await requireSession();
      const { data, error } = await supabase.rpc("admin_dashboard_counts");
      if (error || !data) fail("dashboard", error ?? {});
      return data as DashboardCounts;
    },

    async listQrCodes({ filter, serial, from, to, page }) {
      await requireSession();
      let q = supabase.from("admin_qr_overview").select(OVERVIEW_COLUMNS, { count: "exact" });
      if (filter === "unused" || filter === "used" || filter === "revoked") q = q.eq("status", filter);
      if (filter === "pending" || filter === "shipped") q = q.eq("shipment_status", filter);
      if (serial) q = q.eq("serial_no", serial);
      const f = from ? jstStart(from) : null;
      const t = to ? jstEnd(to) : null;
      if (f) q = q.gte("created_at", f);
      if (t) q = q.lte("created_at", t);
      const { data, error, count } = await q.order("created_at", { ascending: false }).range(...range(page));
      if (error) fail("qr_list", error);
      return { rows: (data ?? []) as QrOverviewRow[], total: count ?? 0 };
    },

    getQrOverview,

    async listAddresses({ page, serial }) {
      await requireSession();
      let q = supabase.from("admin_qr_overview").select(OVERVIEW_COLUMNS, { count: "exact" }).eq("status", "used");
      if (serial) q = q.eq("serial_no", serial);
      const { data, error, count } = await q.order("address_registered_at", { ascending: false }).range(...range(page));
      if (error) fail("address_list", error);
      return { items: await withAddresses((data ?? []) as QrOverviewRow[]), total: count ?? 0 };
    },

    async listShipments({ status, page }) {
      await requireSession();
      const base = supabase
        .from("admin_qr_overview")
        .select(OVERVIEW_COLUMNS, { count: "exact" })
        .eq("shipment_status", status);
      const ordered =
        status === "pending"
          ? base.order("address_registered_at", { ascending: true })
          : base.order("shipped_at", { ascending: false });
      const { data, error, count } = await ordered.range(...range(page));
      if (error) fail("shipment_list", error);
      return { items: await withAddresses((data ?? []) as QrOverviewRow[]), total: count ?? 0 };
    },

    async getAddressDetail(qrCodeId) {
      const qr = await getQrOverview(qrCodeId);
      if (!qr) return null;
      const address = (await addressesFor([qrCodeId])).get(qrCodeId) ?? null;
      const entityIds = address ? [qrCodeId, address.id] : [qrCodeId];
      const { data: logs, error } = await supabase
        .from("audit_logs")
        .select(AUDIT_COLUMNS)
        .in("entity_id", entityIds)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) fail("history", error);
      // 発送ログは shipments.id に紐づくため metadata.qr_code_id で取得する
      const { data: shipLogs, error: shipError } = await supabase
        .from("audit_logs")
        .select(AUDIT_COLUMNS)
        .eq("action", "shipment.mark_shipped")
        .eq("metadata->>qr_code_id", qrCodeId);
      if (shipError) fail("ship_history", shipError);
      const history = [...((logs ?? []) as AuditLogRow[]), ...((shipLogs ?? []) as AuditLogRow[])].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
      return { qr, address, history };
    },

    async listAuditLogs({ page, action }) {
      await requireSession();
      let q = supabase.from("audit_logs").select(AUDIT_COLUMNS, { count: "exact" });
      if (action) q = q.eq("action", action);
      const { data, error, count } = await q.order("created_at", { ascending: false }).range(...range(page));
      if (error) fail("audit", error);
      return { rows: (data ?? []) as AuditLogRow[], total: count ?? 0 };
    },

    async getAdminNames() {
      await requireSession();
      const { data, error } = await supabase.from("admin_users").select("user_id, display_name");
      if (error) fail("admin_names", error);
      return new Map((data ?? []).map((r) => [r.user_id as string, r.display_name as string]));
    },

    async issueQrCode() {
      await requireSession();
      const { data, error } = await supabase.rpc("issue_qr_code");
      if (error || !data) fail("issue", error ?? {});
      return data as IssuedQr;
    },

    async revokeQrCode(id) {
      await requireSession();
      const { data, error } = await supabase.rpc("revoke_qr_code", { p_qr_code_id: id });
      if (error) fail("revoke", error);
      return data;
    },

    async markShipped(qrCodeId) {
      await requireSession();
      const { data, error } = await supabase.rpc("mark_shipped", { p_qr_code_id: qrCodeId });
      if (error) fail("mark_shipped", error);
      return data;
    },

    async updateAddress(qrCodeId, address: Address) {
      await requireSession();
      const { data, error } = await supabase.rpc("admin_update_address", { p_qr_code_id: qrCodeId, ...toRpcArgs(address) });
      if (error) fail("update_address", error);
      return data;
    },

    async redeemStatus(token): Promise<RedeemStatus> {
      const { data, error } = await supabase.rpc("redeem_status", { p_token: token });
      if (error) fail("redeem_status", error);
      return data as RedeemStatus;
    },

    async redeemSubmit(token, address): Promise<RedeemSubmitResult> {
      const { data, error } = await supabase.rpc("submit_redeem", { p_token: token, ...toRpcArgs(address) });
      if (error) fail("redeem_submit", error);
      const r = data as { status: string; fields?: AddressField[] };
      if (r.status === "validation") return { status: "validation", fields: r.fields ?? [] };
      return { status: r.status as Exclude<RedeemSubmitResult["status"], "validation"> };
    },
  };
}
