import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAdmin,
  createPlainUser,
  createTestDb,
  issue,
  redeem,
  sampleAddress,
  type TestDb,
} from "./helpers";

let db: TestDb;
let adminId: string;
let inactiveAdminId: string;
let userId: string;
let qrId: string;
let qrHash: string;

const TABLES = ["qr_codes", "shipping_addresses", "shipments", "audit_logs", "admin_users", "admin_qr_overview"];

beforeAll(async () => {
  db = await createTestDb();
  adminId = await createAdmin(db);
  inactiveAdminId = await createAdmin(db, { active: false });
  userId = await createPlainUser(db);
  const qr = await issue(db, adminId);
  qrId = qr.id;
  qrHash = qr.hash;
  const used = await issue(db, adminId);
  await redeem(db, used.hash);
});
afterAll(async () => {
  await db.close();
});

describe("anon（顧客のブラウザから直接アクセスした場合）", () => {
  it.each(TABLES)("%s を読めない", async (table) => {
    await expect(db.query("anon", null, `select * from public.${table}`)).rejects.toThrow(/permission denied/);
  });

  it("住所を直接 INSERT できない", async () => {
    await expect(
      db.query(
        "anon",
        null,
        "insert into public.shipping_addresses (qr_code_id, recipient_name, postal_code, prefecture, city, address_line, phone) values ($1,'a','100-0001','東京都','a','a','09012345678')",
        [qrId],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["redeem_qr_code", "select public.redeem_qr_code('x','a','b','c','d','e','f','g')"],
    ["check_rate_limit", "select public.check_rate_limit('x', 1, 1)"],
    ["issue_qr_code", "select public.issue_qr_code()"],
    ["mark_shipped", `select public.mark_shipped('${"00000000-0000-0000-0000-000000000000"}')`],
  ])("関数 %s を実行できない", async (_name, sql) => {
    await expect(db.query("anon", null, sql)).rejects.toThrow(/permission denied/);
  });

  it("private スキーマにアクセスできない", async () => {
    await expect(db.query("anon", null, "select * from private.rate_limits")).rejects.toThrow(/permission denied/);
  });
});

describe("管理者ではない認証済みユーザー", () => {
  it.each(TABLES)("%s の行が見えない", async (table) => {
    const cols = table === "qr_codes" ? "id" : "*";
    const { rows } = await db.query("authenticated", userId, `select ${cols} from public.${table}`);
    expect(rows).toHaveLength(0);
  });

  it.each([
    ["issue_qr_code", "select public.issue_qr_code()"],
    ["revoke_qr_code", "select public.revoke_qr_code($1)"],
    ["mark_shipped", "select public.mark_shipped($1)"],
    ["admin_dashboard_counts", "select public.admin_dashboard_counts()"],
  ])("管理者用関数 %s は forbidden", async (_name, sql) => {
    const params = sql.includes("$1") ? [qrId] : [];
    await expect(db.query("authenticated", userId, sql, params)).rejects.toThrow(/forbidden/);
  });

  it("顧客用の住所登録関数を実行できない", async () => {
    await expect(
      db.query("authenticated", userId, "select public.redeem_qr_code('x','a','b','c','d','e','f','g')"),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("無効化された管理者", () => {
  it("データを読めず、操作もできない", async () => {
    const { rows } = await db.query("authenticated", inactiveAdminId, "select id from public.qr_codes");
    expect(rows).toHaveLength(0);
    await expect(
      db.query("authenticated", inactiveAdminId, "select public.revoke_qr_code($1)", [qrId]),
    ).rejects.toThrow(/forbidden/);
  });
});

describe("有効な管理者", () => {
  it("一覧・住所・発送・履歴を読める", async () => {
    for (const table of ["shipping_addresses", "shipments", "audit_logs", "admin_users", "admin_qr_overview"]) {
      const { rows } = await db.query("authenticated", adminId, `select * from public.${table}`);
      expect(rows.length).toBeGreaterThan(0);
    }
    const { rows } = await db.query("authenticated", adminId, "select id, serial_no, status from public.qr_codes");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("token_hash 列は読めない", async () => {
    await expect(
      db.query("authenticated", adminId, "select token_hash from public.qr_codes"),
    ).rejects.toThrow(/permission denied/);
  });

  it("テーブルを直接 UPDATE / DELETE / INSERT できない（関数経由のみ）", async () => {
    await expect(
      db.query("authenticated", adminId, "update public.shipments set status = 'shipped'"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("authenticated", adminId, "delete from public.shipping_addresses"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("authenticated", adminId, "update public.qr_codes set status = 'unused'"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("authenticated", adminId, "insert into public.audit_logs (actor_type, action, entity_type, entity_id) values ('customer','qr.issue','qr_code',$1)", [qrId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("内部用の住所登録関数（ハッシュを受け取る redeem_qr_code）は実行できない", async () => {
    await expect(
      db.query("authenticated", adminId, "select public.redeem_qr_code($1,'a','100-0001','東京都','a','a','','09012345678')", [qrHash]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("service_role（運用・保守用。アプリからは使用しない）", () => {
  it("auth.uid() がないため管理者用関数は実行できない", async () => {
    await expect(db.query("service_role", null, "select public.revoke_qr_code($1)", [qrId])).rejects.toThrow(
      /forbidden|permission denied/,
    );
  });

  it("住所登録関数は service_role から実行できる", async () => {
    const qr = await issue(db, adminId);
    expect(await redeem(db, qr.hash, sampleAddress)).toBe("ok");
  });
});
