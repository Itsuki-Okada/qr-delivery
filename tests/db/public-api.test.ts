import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdmin, createTestDb, issue, newToken, sampleAddress, type TestDb } from "./helpers";

// 静的ホスティング構成で、顧客のブラウザが anon ロールで直接呼ぶ関数のテスト
let db: TestDb;
let adminId: string;
let ipSeq = 0;

beforeAll(async () => {
  db = await createTestDb();
  adminId = await createAdmin(db);
});
afterAll(async () => {
  await db.close();
});

/** テストごとに別の IP として呼び出す（レート制限の影響を分離） */
function freshIp() {
  ipSeq += 1;
  return `198.51.100.${ipSeq}`;
}

async function status(token: string, ip = freshIp()) {
  const { rows } = await db.as(
    "anon",
    null,
    (c) => c.query<{ s: string }>("select public.redeem_status($1) as s", [token]),
    { "cf-connecting-ip": ip },
  );
  return rows[0].s;
}

async function submit(token: string, a: Partial<typeof sampleAddress> = {}, ip = freshIp()) {
  const v = { ...sampleAddress, ...a };
  const { rows } = await db.as(
    "anon",
    null,
    (c) =>
      c.query<{ r: { status: string; fields?: string[] } }>(
        "select public.submit_redeem($1,$2,$3,$4,$5,$6,$7,$8) as r",
        [token, v.recipient_name, v.postal_code, v.prefecture, v.city, v.address_line, v.building, v.phone],
      ),
    { "cf-connecting-ip": ip },
  );
  return rows[0].r;
}

describe("redeem_status（顧客の画面表示）", () => {
  it("未使用 → used → 状態がそのまま返る。QR の詳細や住所は返さない", async () => {
    const qr = await issue(db, adminId);
    expect(await status(qr.token)).toBe("unused");
    expect((await submit(qr.token)).status).toBe("ok");
    expect(await status(qr.token)).toBe("used");
  });

  it("無効化済み・存在しない・形式不正は区別して返す", async () => {
    const qr = await issue(db, adminId);
    await db.query("authenticated", adminId, "select public.revoke_qr_code($1)", [qr.id]);
    expect(await status(qr.token)).toBe("revoked");
    expect(await status(newToken().token)).toBe("invalid");
    expect(await status("short")).toBe("invalid");
    expect(await status(qr.hash)).toBe("invalid"); // ハッシュを渡しても照合されない
  });
});

describe("submit_redeem（顧客の住所登録）", () => {
  it("トークンを DB 側でハッシュ化して照合し、住所を保存して QR を used にする", async () => {
    const qr = await issue(db, adminId);
    expect(await submit(qr.token)).toEqual({ status: "ok" });
    const { rows } = await db.pool.query(
      "select q.status, a.recipient_name from public.qr_codes q join public.shipping_addresses a on a.qr_code_id = q.id where q.id = $1",
      [qr.id],
    );
    expect(rows[0]).toEqual({ status: "used", recipient_name: sampleAddress.recipient_name });
  });

  it("使用済みでの再登録を拒否する", async () => {
    const qr = await issue(db, adminId);
    await submit(qr.token);
    expect(await submit(qr.token, { recipient_name: "別人" })).toEqual({ status: "used" });
  });

  it("サーバー側で入力値を検証し、誤りのある項目名を返す（QR は unused のまま）", async () => {
    const qr = await issue(db, adminId);
    const r = await submit(qr.token, {
      recipient_name: "",
      postal_code: "1000001",
      prefecture: "架空県",
      phone: "12345",
      city: "千代田‮区",
      building: "あ".repeat(201),
    });
    expect(r.status).toBe("validation");
    expect(r.fields?.sort()).toEqual(["building", "city", "phone", "postal_code", "prefecture", "recipient_name"]);
    expect(await status(qr.token)).toBe("unused");
  });

  it("日本語の文字数を正しく数える（100文字の氏名は可、101文字は不可）", async () => {
    const ok = await issue(db, adminId);
    expect((await submit(ok.token, { recipient_name: "あ".repeat(100) })).status).toBe("ok");
    const ng = await issue(db, adminId);
    expect((await submit(ng.token, { recipient_name: "あ".repeat(101) })).fields).toEqual(["recipient_name"]);
  });

  it("前後の空白は除去して保存し、建物名が空なら NULL", async () => {
    const qr = await issue(db, adminId);
    expect((await submit(qr.token, { recipient_name: "  山田 太郎  ", building: "  " })).status).toBe("ok");
    const { rows } = await db.pool.query("select recipient_name, building from public.shipping_addresses where qr_code_id = $1", [qr.id]);
    expect(rows[0]).toEqual({ recipient_name: "山田 太郎", building: null });
  });

  it("anon からの同時送信（20並列・別 IP）でも登録は1件", async () => {
    const qr = await issue(db, adminId);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => submit(qr.token, { recipient_name: `同時${i}` })),
    );
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.status === "used")).toHaveLength(19);
    const { rows } = await db.pool.query("select count(*)::int n from public.shipping_addresses where qr_code_id = $1", [qr.id]);
    expect(rows[0].n).toBe(1);
  });
});

describe("レート制限（IP ごと）", () => {
  it("状態確認は同一 IP から 1 分 30 回まで", async () => {
    const ip = freshIp();
    const token = newToken().token;
    const results = [];
    for (let i = 0; i < 31; i++) results.push(await status(token, ip));
    expect(results.slice(0, 30).every((r) => r === "invalid")).toBe(true);
    expect(results[30]).toBe("rate_limited");
    // 別の IP は影響を受けない
    expect(await status(token, freshIp())).toBe("invalid");
  });

  it("住所送信は同一 IP から 10 分 10 回まで", async () => {
    const ip = freshIp();
    const results = [];
    for (let i = 0; i < 11; i++) results.push((await submit(newToken().token, {}, ip)).status);
    expect(results.slice(0, 10).every((r) => r === "invalid")).toBe(true);
    expect(results[10]).toBe("rate_limited");
  });

  it("x-forwarded-for しかない場合は先頭の IP を使う", async () => {
    const token = newToken().token;
    const call = () =>
      db.as("anon", null, (c) => c.query<{ s: string }>("select public.redeem_status($1) as s", [token]), {
        "x-forwarded-for": "203.0.113.77, 10.0.0.1",
      });
    for (let i = 0; i < 30; i++) await call();
    expect((await call()).rows[0].s).toBe("rate_limited");
  });

  it("レート制限テーブルに生の IP を保存しない", async () => {
    const { rows } = await db.pool.query("select key from private.rate_limits");
    const keys = rows.map((r) => r.key).join("\n");
    expect(keys).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe("anon の権限は顧客用 2 関数のみ", () => {
  it("管理者用関数・内部関数・テーブルにはアクセスできない", async () => {
    for (const sql of [
      "select public.issue_qr_code()",
      "select public.admin_dashboard_counts()",
      "select public.check_rate_limit('k', 1, 1)",
      "select private.hash_token('x')",
      "select id from public.qr_codes",
      "select * from public.shipping_addresses",
    ]) {
      await expect(db.query("anon", null, sql)).rejects.toThrow(/permission denied/);
    }
  });
});
