import type { Address, AddressField } from "@/lib/validation/address";

// 画面から見たデータ操作の窓口。
//   - SupabaseBackend: 本番（Supabase の DB 関数・RLS を直接呼ぶ。権限検証はすべて DB 側）
//   - DemoBackend    : デモ（ブラウザ内の localStorage だけで同じ振る舞いを再現。外部通信なし）
// 画面はこのインターフェースだけに依存し、どちらでも同じように動く。

export interface Admin {
  id: string;
  email: string | null;
  displayName: string;
}

export type QrStatus = "unused" | "used" | "revoked";
export type ShipmentStatus = "pending" | "shipped";

export interface DashboardCounts {
  total: number;
  awaiting_address: number;
  awaiting_shipment: number;
  shipped: number;
  revoked: number;
}

export interface QrOverviewRow {
  id: string;
  serial_no: number;
  status: QrStatus;
  created_at: string;
  created_by: string;
  used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  address_registered_at: string | null;
  shipment_status: ShipmentStatus | null;
  shipped_at: string | null;
  shipped_by: string | null;
}

export interface AddressRow {
  id: string;
  qr_code_id: string;
  recipient_name: string;
  postal_code: string;
  prefecture: string;
  city: string;
  address_line: string;
  building: string | null;
  phone: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export type AuditAction = "qr.issue" | "qr.revoke" | "address.register" | "address.update" | "shipment.mark_shipped";

export interface AuditLogRow {
  id: string;
  actor_type: "admin" | "customer";
  actor_id: string | null;
  action: AuditAction;
  entity_type: "qr_code" | "shipping_address" | "shipment";
  entity_id: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export const QR_FILTERS = ["all", "unused", "used", "pending", "shipped", "revoked"] as const;
export type QrFilter = (typeof QR_FILTERS)[number];

export const PAGE_SIZE = 50;

export interface ListQrParams {
  filter?: QrFilter;
  /** 識別番号（parseSerial 済み） */
  serial?: number | null;
  /** YYYY-MM-DD（日本時間） */
  from?: string;
  to?: string;
  page?: number;
}

export interface AddressListItem {
  qr: QrOverviewRow;
  address: AddressRow;
}

export interface IssuedQr {
  id: string;
  serial_no: number;
  created_at: string;
  /** 生のトークン。発行直後に 1 度だけ返され、どこにも保存されない */
  token: string;
}

export type RedeemStatus = QrStatus | "invalid" | "rate_limited";

export type RedeemSubmitResult =
  | { status: "ok" | "invalid" | "used" | "revoked" | "rate_limited" }
  | { status: "validation"; fields: AddressField[] };

export type SignInResult = { ok: true; admin: Admin } | { ok: false; message: string };

/** 認証されていない・管理者でない状態で管理用の操作を呼んだ場合 */
export class NotAuthorizedError extends Error {
  constructor() {
    super("not authorized");
    this.name = "NotAuthorizedError";
  }
}

export interface Backend {
  readonly mode: "supabase" | "demo";

  // ---- 管理者認証 ----
  getCurrentAdmin(): Promise<Admin | null>;
  signIn(email: string, password: string): Promise<SignInResult>;
  signOut(): Promise<void>;

  // ---- 管理者用（未認証なら NotAuthorizedError） ----
  getDashboardCounts(): Promise<DashboardCounts>;
  listQrCodes(params: ListQrParams): Promise<{ rows: QrOverviewRow[]; total: number }>;
  getQrOverview(id: string): Promise<QrOverviewRow | null>;
  listAddresses(params: { page?: number; serial?: number | null }): Promise<{ items: AddressListItem[]; total: number }>;
  listShipments(params: { status: ShipmentStatus; page?: number }): Promise<{ items: AddressListItem[]; total: number }>;
  getAddressDetail(qrCodeId: string): Promise<{ qr: QrOverviewRow; address: AddressRow | null; history: AuditLogRow[] } | null>;
  listAuditLogs(params: { page?: number; action?: AuditAction }): Promise<{ rows: AuditLogRow[]; total: number }>;
  getAdminNames(): Promise<Map<string, string>>;

  issueQrCode(): Promise<IssuedQr>;
  revokeQrCode(id: string): Promise<"ok" | "not_found" | "not_unused">;
  markShipped(qrCodeId: string): Promise<"ok" | "not_found" | "already_shipped">;
  updateAddress(qrCodeId: string, address: Address): Promise<"ok" | "not_found" | "no_change">;

  // ---- 顧客用（ログイン不要） ----
  redeemStatus(token: string): Promise<RedeemStatus>;
  redeemSubmit(token: string, address: Address): Promise<RedeemSubmitResult>;
}
