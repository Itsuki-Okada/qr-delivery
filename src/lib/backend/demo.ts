import { generateToken, hashToken, isWellFormedToken } from "@/lib/token";
import { ADDRESS_FIELDS, validateAddress, type Address } from "@/lib/validation/address";
import {
  NotAuthorizedError,
  PAGE_SIZE,
  type Admin,
  type AddressListItem,
  type AddressRow,
  type AuditAction,
  type AuditLogRow,
  type Backend,
  type QrOverviewRow,
  type QrStatus,
  type ShipmentStatus,
} from "./types";

// デモ用バックエンド（Supabase なし）。
// データはこのブラウザの localStorage にのみ保存され、外部へは一切送信しない。
// 本番の DB 関数と同じ結果（状態遷移・二重登録防止・操作履歴）になるよう実装している。

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEMO_ACCOUNTS = [
  { email: "demo-admin@example.com", password: "demo-password", displayName: "デモ管理者" },
  { email: "demo-staff@example.com", password: "demo-password", displayName: "デモスタッフ" },
] as const;

const DATA_KEY = "qr-delivery-demo:data:v1";
const SESSION_KEY = "qr-delivery-demo:session:v1";

interface QrRecord {
  id: string;
  serial_no: number;
  token_hash: string;
  status: QrStatus;
  created_at: string;
  created_by: string;
  used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}
interface ShipmentRecord {
  id: string;
  qr_code_id: string;
  status: ShipmentStatus;
  shipped_at: string | null;
  shipped_by: string | null;
  created_at: string;
  updated_at: string;
}
interface DemoState {
  seq: number;
  admins: { id: string; email: string; password: string; display_name: string }[];
  qr: QrRecord[];
  addresses: AddressRow[];
  shipments: ShipmentRecord[];
  audit: AuditLogRow[];
}

const uuid = () => globalThis.crypto.randomUUID();

function seedState(now: Date): DemoState {
  const admins = DEMO_ACCOUNTS.map((a) => ({ id: uuid(), email: a.email, password: a.password, display_name: a.displayName }));
  const s: DemoState = { seq: 0, admins, qr: [], addresses: [], shipments: [], audit: [] };
  const [admin, staff] = admins;
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();
  const samples: { status: QrStatus | "pending" | "shipped"; name?: string; created: number }[] = [
    { status: "shipped", name: "見本 一郎", created: 120 },
    { status: "pending", name: "見本 花子", created: 96 },
    { status: "pending", name: "見本 次郎", created: 72 },
    { status: "revoked", created: 60 },
    { status: "unused", created: 30 },
    { status: "unused", created: 5 },
  ];
  for (const sample of samples) {
    s.seq += 1;
    const id = uuid();
    const created_at = at(sample.created);
    const qr: QrRecord = {
      id,
      serial_no: s.seq,
      // 見本データのトークンは誰も知らない（ランダムなハッシュ値のみ保持）
      token_hash: Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""),
      status: "unused",
      created_at,
      created_by: admin.id,
      used_at: null,
      revoked_at: null,
      revoked_by: null,
    };
    s.qr.push(qr);
    s.audit.push(audit("admin", admin.id, "qr.issue", "qr_code", id, { serial_no: qr.serial_no }, created_at));
    if (sample.status === "revoked") {
      Object.assign(qr, { status: "revoked", revoked_at: at(sample.created - 2), revoked_by: staff.id });
      s.audit.push(audit("admin", staff.id, "qr.revoke", "qr_code", id, { serial_no: qr.serial_no }, qr.revoked_at!));
    }
    if (sample.status === "pending" || sample.status === "shipped") {
      const usedAt = at(sample.created - 24);
      Object.assign(qr, { status: "used", used_at: usedAt });
      s.addresses.push({
        id: uuid(),
        qr_code_id: id,
        recipient_name: sample.name!,
        postal_code: "100-0001",
        prefecture: "東京都",
        city: "千代田区",
        address_line: `千代田${qr.serial_no}-1`,
        building: qr.serial_no % 2 ? "見本ハイツ 101" : null,
        phone: "0000000000",
        created_at: usedAt,
        updated_at: usedAt,
        updated_by: null,
      });
      const shipment: ShipmentRecord = {
        id: uuid(),
        qr_code_id: id,
        status: "pending",
        shipped_at: null,
        shipped_by: null,
        created_at: usedAt,
        updated_at: usedAt,
      };
      s.shipments.push(shipment);
      s.audit.push(audit("customer", null, "address.register", "qr_code", id, { serial_no: qr.serial_no }, usedAt));
      if (sample.status === "shipped") {
        const shippedAt = at(sample.created - 48);
        Object.assign(shipment, { status: "shipped", shipped_at: shippedAt, shipped_by: admin.id, updated_at: shippedAt });
        s.audit.push(
          audit("admin", admin.id, "shipment.mark_shipped", "shipment", shipment.id, { serial_no: qr.serial_no, qr_code_id: id }, shippedAt),
        );
      }
    }
  }
  return s;
}

function audit(
  actor_type: "admin" | "customer",
  actor_id: string | null,
  action: AuditAction,
  entity_type: AuditLogRow["entity_type"],
  entity_id: string,
  metadata: Record<string, unknown>,
  created_at = new Date().toISOString(),
): AuditLogRow {
  return { id: uuid(), actor_type, actor_id, action, entity_type, entity_id, created_at, metadata };
}

function paginate<T>(rows: T[], page = 1) {
  const p = Math.max(1, Math.floor(page));
  return rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
}

export interface DemoExtras {
  reset(): void;
  /**
   * 別の端末（ブラウザ）で発行されたデモ用 QR を、この端末で未使用の QR として受け入れる。
   * デモのデータは端末ごとに独立しているため、スマホで顧客画面を体験するために使う。
   * 本番（Supabase）には存在しない機能。
   */
  adoptForeignToken(token: string): Promise<boolean>;
}

export function createDemoBackend(opts: {
  data: KeyValueStorage;
  session: KeyValueStorage;
  /** テスト用: 見本データを入れない */
  emptySeed?: boolean;
}): Backend & DemoExtras {
  function load(): DemoState {
    const raw = opts.data.getItem(DATA_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as DemoState;
      } catch {
        // 壊れたデータは作り直す
      }
    }
    const fresh = opts.emptySeed
      ? { ...seedState(new Date()), qr: [], addresses: [], shipments: [], audit: [], seq: 0 }
      : seedState(new Date());
    save(fresh);
    return fresh;
  }
  function save(s: DemoState) {
    opts.data.setItem(DATA_KEY, JSON.stringify(s));
  }
  /** 読み込み → 変更 → 保存を 1 単位で行う（JavaScript は単一スレッドのため途中で割り込まれない） */
  function transact<T>(fn: (s: DemoState) => T): T {
    const s = load();
    const result = fn(s);
    save(s);
    return result;
  }

  function currentAdminRecord(s: DemoState) {
    const id = opts.session.getItem(SESSION_KEY);
    return id ? (s.admins.find((a) => a.id === id) ?? null) : null;
  }
  function requireAdmin(s: DemoState) {
    const admin = currentAdminRecord(s);
    if (!admin) throw new NotAuthorizedError();
    return admin;
  }

  function overview(s: DemoState, q: QrRecord): QrOverviewRow {
    const address = s.addresses.find((a) => a.qr_code_id === q.id);
    const shipment = s.shipments.find((x) => x.qr_code_id === q.id);
    return {
      id: q.id,
      serial_no: q.serial_no,
      status: q.status,
      created_at: q.created_at,
      created_by: q.created_by,
      used_at: q.used_at,
      revoked_at: q.revoked_at,
      revoked_by: q.revoked_by,
      address_registered_at: address?.created_at ?? null,
      shipment_status: shipment?.status ?? null,
      shipped_at: shipment?.shipped_at ?? null,
      shipped_by: shipment?.shipped_by ?? null,
    };
  }
  function items(s: DemoState, rows: QrOverviewRow[]): AddressListItem[] {
    return rows.flatMap((qr) => {
      const address = s.addresses.find((a) => a.qr_code_id === qr.id);
      return address ? [{ qr, address: { ...address } }] : [];
    });
  }
  const desc = (k: keyof QrOverviewRow) => (a: QrOverviewRow, b: QrOverviewRow) =>
    String(b[k] ?? "").localeCompare(String(a[k] ?? ""));
  const asc = (k: keyof QrOverviewRow) => (a: QrOverviewRow, b: QrOverviewRow) =>
    String(a[k] ?? "").localeCompare(String(b[k] ?? ""));

  return {
    mode: "demo",

    reset() {
      opts.data.removeItem(DATA_KEY);
      opts.session.removeItem(SESSION_KEY);
    },

    async getCurrentAdmin(): Promise<Admin | null> {
      const a = currentAdminRecord(load());
      return a ? { id: a.id, email: a.email, displayName: a.display_name } : null;
    },

    async signIn(email, password) {
      const s = load();
      const a = s.admins.find((x) => x.email === email.trim().toLowerCase() && x.password === password);
      if (!a) return { ok: false, message: "メールアドレスまたはパスワードが正しくありません。" };
      opts.session.setItem(SESSION_KEY, a.id);
      return { ok: true, admin: { id: a.id, email: a.email, displayName: a.display_name } };
    },

    async signOut() {
      opts.session.removeItem(SESSION_KEY);
    },

    async getDashboardCounts() {
      const s = load();
      requireAdmin(s);
      return {
        total: s.qr.length,
        awaiting_address: s.qr.filter((q) => q.status === "unused").length,
        awaiting_shipment: s.shipments.filter((x) => x.status === "pending").length,
        shipped: s.shipments.filter((x) => x.status === "shipped").length,
        revoked: s.qr.filter((q) => q.status === "revoked").length,
      };
    },

    async listQrCodes({ filter, serial, from, to, page }) {
      const s = load();
      requireAdmin(s);
      let rows = s.qr.map((q) => overview(s, q));
      if (filter === "unused" || filter === "used" || filter === "revoked") rows = rows.filter((r) => r.status === filter);
      if (filter === "pending" || filter === "shipped") rows = rows.filter((r) => r.shipment_status === filter);
      if (serial) rows = rows.filter((r) => r.serial_no === serial);
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
        const t = new Date(`${from}T00:00:00+09:00`).getTime();
        rows = rows.filter((r) => new Date(r.created_at).getTime() >= t);
      }
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        const t = new Date(`${to}T23:59:59.999+09:00`).getTime();
        rows = rows.filter((r) => new Date(r.created_at).getTime() <= t);
      }
      rows.sort(desc("created_at"));
      return { rows: paginate(rows, page), total: rows.length };
    },

    async getQrOverview(id) {
      const s = load();
      requireAdmin(s);
      const q = s.qr.find((x) => x.id === id);
      return q ? overview(s, q) : null;
    },

    async listAddresses({ page, serial }) {
      const s = load();
      requireAdmin(s);
      let rows = s.qr.filter((q) => q.status === "used").map((q) => overview(s, q));
      if (serial) rows = rows.filter((r) => r.serial_no === serial);
      rows.sort(desc("address_registered_at"));
      return { items: items(s, paginate(rows, page)), total: rows.length };
    },

    async listShipments({ status, page }) {
      const s = load();
      requireAdmin(s);
      const rows = s.qr.map((q) => overview(s, q)).filter((r) => r.shipment_status === status);
      rows.sort(status === "pending" ? asc("address_registered_at") : desc("shipped_at"));
      return { items: items(s, paginate(rows, page)), total: rows.length };
    },

    async getAddressDetail(qrCodeId) {
      const s = load();
      requireAdmin(s);
      const q = s.qr.find((x) => x.id === qrCodeId);
      if (!q) return null;
      const address = s.addresses.find((a) => a.qr_code_id === qrCodeId) ?? null;
      const history = s.audit
        .filter(
          (l) =>
            l.entity_id === qrCodeId ||
            (address && l.entity_id === address.id) ||
            (l.action === "shipment.mark_shipped" && l.metadata.qr_code_id === qrCodeId),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { qr: overview(s, q), address: address ? { ...address } : null, history };
    },

    async listAuditLogs({ page, action }) {
      const s = load();
      requireAdmin(s);
      const rows = s.audit.filter((l) => !action || l.action === action).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { rows: paginate(rows, page), total: rows.length };
    },

    async getAdminNames() {
      const s = load();
      requireAdmin(s);
      return new Map(s.admins.map((a) => [a.id, a.display_name]));
    },

    async issueQrCode() {
      const token = generateToken();
      const token_hash = await hashToken(token);
      return transact((s) => {
        const admin = requireAdmin(s);
        s.seq += 1;
        const q: QrRecord = {
          id: uuid(),
          serial_no: s.seq,
          token_hash,
          status: "unused",
          created_at: new Date().toISOString(),
          created_by: admin.id,
          used_at: null,
          revoked_at: null,
          revoked_by: null,
        };
        s.qr.push(q);
        s.audit.push(audit("admin", admin.id, "qr.issue", "qr_code", q.id, { serial_no: q.serial_no }));
        return { id: q.id, serial_no: q.serial_no, created_at: q.created_at, token };
      });
    },

    async revokeQrCode(id) {
      return transact((s) => {
        const admin = requireAdmin(s);
        const q = s.qr.find((x) => x.id === id);
        if (!q) return "not_found";
        if (q.status !== "unused") return "not_unused";
        Object.assign(q, { status: "revoked", revoked_at: new Date().toISOString(), revoked_by: admin.id });
        s.audit.push(audit("admin", admin.id, "qr.revoke", "qr_code", q.id, { serial_no: q.serial_no }));
        return "ok";
      });
    },

    async markShipped(qrCodeId) {
      return transact((s) => {
        const admin = requireAdmin(s);
        const sh = s.shipments.find((x) => x.qr_code_id === qrCodeId);
        if (!sh) return "not_found";
        if (sh.status !== "pending") return "already_shipped";
        const now = new Date().toISOString();
        Object.assign(sh, { status: "shipped", shipped_at: now, shipped_by: admin.id, updated_at: now });
        const serial = s.qr.find((q) => q.id === qrCodeId)?.serial_no;
        s.audit.push(audit("admin", admin.id, "shipment.mark_shipped", "shipment", sh.id, { serial_no: serial, qr_code_id: qrCodeId }));
        return "ok";
      });
    },

    async updateAddress(qrCodeId, input) {
      const v = validateAddress(input);
      if (!v.success) throw new Error("invalid address");
      return transact((s) => {
        const admin = requireAdmin(s);
        const a = s.addresses.find((x) => x.qr_code_id === qrCodeId);
        if (!a) return "not_found";
        const next = { ...v.data, building: v.data.building || null };
        const changed = ADDRESS_FIELDS.filter((f) => (a[f] ?? null) !== (next[f] ?? null));
        if (changed.length === 0) return "no_change";
        Object.assign(a, next, { updated_at: new Date().toISOString(), updated_by: admin.id });
        const serial = s.qr.find((q) => q.id === qrCodeId)?.serial_no;
        s.audit.push(
          audit("admin", admin.id, "address.update", "shipping_address", a.id, {
            serial_no: serial,
            qr_code_id: qrCodeId,
            changed_fields: changed,
          }),
        );
        return "ok";
      });
    },

    async adoptForeignToken(token) {
      if (!isWellFormedToken(token)) return false;
      const token_hash = await hashToken(token);
      return transact((s) => {
        if (s.qr.some((q) => q.token_hash === token_hash)) return false;
        const admin = s.admins[0];
        s.seq += 1;
        const q: QrRecord = {
          id: uuid(),
          serial_no: s.seq,
          token_hash,
          status: "unused",
          created_at: new Date().toISOString(),
          created_by: admin.id,
          used_at: null,
          revoked_at: null,
          revoked_by: null,
        };
        s.qr.push(q);
        s.audit.push(audit("admin", admin.id, "qr.issue", "qr_code", q.id, { serial_no: q.serial_no, demo_imported: true }));
        return true;
      });
    },

    async redeemStatus(token) {
      if (!isWellFormedToken(token)) return "invalid";
      const hash = await hashToken(token);
      return load().qr.find((q) => q.token_hash === hash)?.status ?? "invalid";
    },

    async redeemSubmit(token, input: Address) {
      if (!isWellFormedToken(token)) return { status: "invalid" };
      const v = validateAddress(input);
      if (!v.success) return { status: "validation", fields: Object.keys(v.fieldErrors) as typeof ADDRESS_FIELDS[number][] };
      const hash = await hashToken(token);
      return transact((s) => {
        const q = s.qr.find((x) => x.token_hash === hash);
        if (!q) return { status: "invalid" as const };
        if (q.status !== "unused") return { status: q.status };
        const now = new Date().toISOString();
        Object.assign(q, { status: "used", used_at: now });
        const address: AddressRow = {
          id: uuid(),
          qr_code_id: q.id,
          ...v.data,
          building: v.data.building || null,
          created_at: now,
          updated_at: now,
          updated_by: null,
        };
        s.addresses.push(address);
        s.shipments.push({ id: uuid(), qr_code_id: q.id, status: "pending", shipped_at: null, shipped_by: null, created_at: now, updated_at: now });
        s.audit.push(audit("customer", null, "address.register", "qr_code", q.id, { serial_no: q.serial_no }));
        return { status: "ok" as const };
      });
    },
  };
}
