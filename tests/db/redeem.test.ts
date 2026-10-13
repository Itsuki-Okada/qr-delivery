import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAdmin,
  sha256Hex,
  createTestDb,
  issue,
  newToken,
  redeem,
  redeemParams,
  redeemSql,
  sampleAddress,
  type TestDb,
} from "./helpers";

let db: TestDb;
let adminId: string;

beforeAll(async () => {
  db = await createTestDb();
  adminId = await createAdmin(db);
});
afterAll(async () => {
  await db.close();
});

async function qrRow(id: string) {
  const { rows } = await db.pool.query("select * from public.qr_codes where id = $1", [id]);
  return rows[0];
}
async function addressCount(id: string) {
  const { rows } = await db.pool.query("select count(*)::int as n from public.shipping_addresses where qr_code_id = $1", [id]);
  return rows[0].n as number;
}

describe("QRコード発行", () => {
  it("ハッシュのみを保存し、発行者と発行日時を記録する", async () => {
    const qr = await issue(db, adminId);
    const row = await qrRow(qr.id);
    expect(row.token_hash).toBe(sha256Hex(qr.token));
    expect(row.token_hash).not.toContain(qr.token);
    expect(row.status).toBe("unused");
    expect(row.created_by).toBe(adminId);
    expect(row.created_at).toBeInstanceOf(Date);

    const { rows } = await db.pool.query(
      "select * from public.audit_logs where entity_id = $1 and action = 'qr.issue'",
      [qr.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(adminId);
    expect(rows[0].metadata).toEqual({ serial_no: Number(qr.serial) });
  });

  it("識別番号は発行ごとに一意", async () => {
    const a = await issue(db, adminId);
    const b = await issue(db, adminId);
    expect(a.serial).not.toBe(b.serial);
  });

  it("トークンは DB の暗号学的乱数で生成された 256 ビット（base64url 43文字）で、毎回異なる", async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const qr = await issue(db, adminId);
      expect(qr.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(qr.token, "base64url")).toHaveLength(32);
      tokens.add(qr.token);
    }
    expect(tokens.size).toBe(50);
  });

  it("生のトークンは DB のどこにも保存されない", async () => {
    const qr = await issue(db, adminId);
    for (const table of ["qr_codes", "audit_logs"]) {
      const { rows } = await db.pool.query(`select * from public.${table}`);
      expect(JSON.stringify(rows)).not.toContain(qr.token);
    }
  });
});

describe("住所登録", () => {
  it("正常に登録でき、同時に QR が used になり、発送(pending)と操作履歴が作られる", async () => {
    const qr = await issue(db, adminId);
    expect(await redeem(db, qr.hash)).toBe("ok");

    const row = await qrRow(qr.id);
    expect(row.status).toBe("used");
    expect(row.used_at).toBeInstanceOf(Date);

    const { rows: addr } = await db.pool.query("select * from public.shipping_addresses where qr_code_id = $1", [qr.id]);
    expect(addr).toHaveLength(1);
    expect(addr[0]).toMatchObject(sampleAddress);
    expect(addr[0].updated_by).toBeNull();

    const { rows: ship } = await db.pool.query("select * from public.shipments where qr_code_id = $1", [qr.id]);
    expect(ship).toHaveLength(1);
    expect(ship[0].status).toBe("pending");

    const { rows: logs } = await db.pool.query(
      "select * from public.audit_logs where entity_id = $1 and action = 'address.register'",
      [qr.id],
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].actor_type).toBe("customer");
    expect(logs[0].actor_id).toBeNull();
  });

  it("建物名が空文字なら NULL として保存する", async () => {
    const qr = await issue(db, adminId);
    expect(await redeem(db, qr.hash, { ...sampleAddress, building: "" })).toBe("ok");
    const { rows } = await db.pool.query("select building from public.shipping_addresses where qr_code_id = $1", [qr.id]);
    expect(rows[0].building).toBeNull();
  });

  it("使用済み QR からの再登録を拒否し、住所は上書きされない", async () => {
    const qr = await issue(db, adminId);
    expect(await redeem(db, qr.hash)).toBe("ok");
    expect(await redeem(db, qr.hash, { ...sampleAddress, recipient_name: "別人" })).toBe("used");
    expect(await addressCount(qr.id)).toBe(1);
    const { rows } = await db.pool.query("select recipient_name from public.shipping_addresses where qr_code_id = $1", [qr.id]);
    expect(rows[0].recipient_name).toBe(sampleAddress.recipient_name);
  });

  it("無効化済み QR からの登録を拒否する", async () => {
    const qr = await issue(db, adminId);
    const { rows } = await db.query("authenticated", adminId, "select public.revoke_qr_code($1) as r", [qr.id]);
    expect(rows[0].r).toBe("ok");
    expect(await redeem(db, qr.hash)).toBe("revoked");
    expect(await addressCount(qr.id)).toBe(0);
    expect((await qrRow(qr.id)).status).toBe("revoked");
  });

  it("存在しないトークン・不正形式のハッシュを拒否する", async () => {
    expect(await redeem(db, newToken().hash)).toBe("invalid");
    expect(await redeem(db, "zzz")).toBe("invalid");
  });

  it("同時アクセス（20並列）でも住所は1件だけ登録される", async () => {
    const qr = await issue(db, adminId);
    const attempts = Array.from({ length: 20 }, (_, i) =>
      db.query<{ result: string }>(
        "service_role",
        null,
        redeemSql(),
        redeemParams(qr.hash, { ...sampleAddress, recipient_name: `同時${i}` }),
      ),
    );
    const results = (await Promise.all(attempts)).map((r) => r.rows[0].result);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "used")).toHaveLength(19);
    expect(await addressCount(qr.id)).toBe(1);
    const { rows } = await db.pool.query("select count(*)::int as n from public.shipments where qr_code_id = $1", [qr.id]);
    expect(rows[0].n).toBe(1);
  });

  it("住所の保存に失敗した場合（制約違反）は全体がロールバックされ QR は unused のまま", async () => {
    const qr = await issue(db, adminId);
    await expect(redeem(db, qr.hash, { ...sampleAddress, prefecture: "架空県" })).rejects.toThrow(/check constraint/);
    const row = await qrRow(qr.id);
    expect(row.status).toBe("unused");
    expect(row.used_at).toBeNull();
    expect(await addressCount(qr.id)).toBe(0);
    // ロールバック後は正しい入力で登録できる
    expect(await redeem(db, qr.hash)).toBe("ok");
  });

  it("住所保存後の処理（発送行作成）で障害が起きても全体がロールバックされる", async () => {
    const qr = await issue(db, adminId);
    await db.pool.query(`
      create function public.test_fail() returns trigger language plpgsql as $$
      begin raise exception 'injected failure'; end $$;
      create trigger test_fail before insert on public.shipments for each row execute function public.test_fail();
    `);
    try {
      await expect(redeem(db, qr.hash)).rejects.toThrow(/injected failure/);
    } finally {
      await db.pool.query("drop trigger test_fail on public.shipments; drop function public.test_fail();");
    }
    expect((await qrRow(qr.id)).status).toBe("unused");
    expect(await addressCount(qr.id)).toBe(0);
    const { rows } = await db.pool.query(
      "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'address.register'",
      [qr.id],
    );
    expect(rows[0].n).toBe(0);
  });

  it("操作履歴に住所・電話番号・トークンを保存しない", async () => {
    const qr = await issue(db, adminId);
    await redeem(db, qr.hash);
    const { rows } = await db.pool.query("select * from public.audit_logs");
    const dump = JSON.stringify(rows);
    for (const secret of [qr.token, qr.hash, sampleAddress.phone, sampleAddress.recipient_name, sampleAddress.address_line, sampleAddress.postal_code]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe("無効化", () => {
  it("未使用のみ無効化でき、無効化者と日時を記録する", async () => {
    const qr = await issue(db, adminId);
    const r = await db.query("authenticated", adminId, "select public.revoke_qr_code($1) as r", [qr.id]);
    expect(r.rows[0].r).toBe("ok");
    const row = await qrRow(qr.id);
    expect(row.revoked_by).toBe(adminId);
    expect(row.revoked_at).toBeInstanceOf(Date);
    // 二度目は not_unused
    const r2 = await db.query("authenticated", adminId, "select public.revoke_qr_code($1) as r", [qr.id]);
    expect(r2.rows[0].r).toBe("not_unused");
  });

  it("使用済み QR は無効化できない", async () => {
    const qr = await issue(db, adminId);
    await redeem(db, qr.hash);
    const r = await db.query("authenticated", adminId, "select public.revoke_qr_code($1) as r", [qr.id]);
    expect(r.rows[0].r).toBe("not_unused");
    expect((await qrRow(qr.id)).status).toBe("used");
  });

  it("used / revoked から unused に戻す更新は CHECK 制約で拒否される", async () => {
    const qr = await issue(db, adminId);
    await redeem(db, qr.hash);
    await expect(
      db.pool.query("update public.qr_codes set status = 'unused' where id = $1", [qr.id]),
    ).rejects.toThrow(/qr_codes_status_consistency/);
  });
});

describe("発送管理", () => {
  it("発送済みにすると発送日時と操作者を記録し、QR の状態は used のまま", async () => {
    const qr = await issue(db, adminId);
    await redeem(db, qr.hash);
    const r = await db.query("authenticated", adminId, "select public.mark_shipped($1) as r", [qr.id]);
    expect(r.rows[0].r).toBe("ok");
    const { rows } = await db.pool.query("select * from public.shipments where qr_code_id = $1", [qr.id]);
    expect(rows[0].status).toBe("shipped");
    expect(rows[0].shipped_by).toBe(adminId);
    expect(rows[0].shipped_at).toBeInstanceOf(Date);
    expect((await qrRow(qr.id)).status).toBe("used");
  });

  it("二重登録を防止する（同時押下でも成功は1回）", async () => {
    const qr = await issue(db, adminId);
    await redeem(db, qr.hash);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.query<{ r: string }>("authenticated", adminId, "select public.mark_shipped($1) as r", [qr.id]),
      ),
    );
    const values = results.map((x) => x.rows[0].r);
    expect(values.filter((v) => v === "ok")).toHaveLength(1);
    expect(values.filter((v) => v === "already_shipped")).toHaveLength(9);
    const { rows } = await db.pool.query(
      "select count(*)::int as n from public.audit_logs where action = 'shipment.mark_shipped' and metadata->>'qr_code_id' = $1",
      [qr.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("住所未登録の QR には発送行がなく、発送済みにできない", async () => {
    const qr = await issue(db, adminId);
    const r = await db.query("authenticated", adminId, "select public.mark_shipped($1) as r", [qr.id]);
    expect(r.rows[0].r).toBe("not_found");
    expect((await qrRow(qr.id)).status).toBe("unused");
  });

  it("発送状態の CHECK 制約: shipped には日時と操作者が必須", async () => {
    const qr = await issue(db, adminId);
    await redeem(db, qr.hash);
    await expect(
      db.pool.query("update public.shipments set status = 'shipped' where qr_code_id = $1", [qr.id]),
    ).rejects.toThrow(/shipments_status_consistency/);
  });
});

describe("管理者による住所修正", () => {
  it("修正内容を保存し、修正者・日時と変更項目名（値なし）を操作履歴に残す", async () => {
    const editor = await createAdmin(db, { name: "編集者" });
    const qr = await issue(db, adminId);
    await redeem(db, qr.hash);
    const updated = { ...sampleAddress, city: "港区", phone: "0312345678" };
    const r = await db.query(
      "authenticated",
      editor,
      "select public.admin_update_address($1,$2,$3,$4,$5,$6,$7,$8) as r",
      [qr.id, updated.recipient_name, updated.postal_code, updated.prefecture, updated.city, updated.address_line, updated.building, updated.phone],
    );
    expect(r.rows[0].r).toBe("ok");

    const { rows } = await db.pool.query("select * from public.shipping_addresses where qr_code_id = $1", [qr.id]);
    expect(rows[0].city).toBe("港区");
    expect(rows[0].phone).toBe("0312345678");
    expect(rows[0].updated_by).toBe(editor);
    expect(rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(rows[0].created_at.getTime());

    const { rows: logs } = await db.pool.query(
      "select * from public.audit_logs where action = 'address.update' and entity_id = $1",
      [rows[0].id],
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].actor_id).toBe(editor);
    expect(logs[0].metadata.changed_fields).toEqual(["city", "phone"]);
    expect(JSON.stringify(logs[0].metadata)).not.toContain("港区");
    expect(JSON.stringify(logs[0].metadata)).not.toContain("0312345678");
  });

  it("変更がなければ no_change を返し履歴を残さない", async () => {
    const qr = await issue(db, adminId);
    await redeem(db, qr.hash);
    const a = sampleAddress;
    const r = await db.query(
      "authenticated",
      adminId,
      "select public.admin_update_address($1,$2,$3,$4,$5,$6,$7,$8) as r",
      [qr.id, a.recipient_name, a.postal_code, a.prefecture, a.city, a.address_line, a.building, a.phone],
    );
    expect(r.rows[0].r).toBe("no_change");
  });

  it("修正後も QR 状態・発送状態は変わらない", async () => {
    const qr = await issue(db, adminId);
    await redeem(db, qr.hash);
    const a = { ...sampleAddress, address_line: "千代田2-2" };
    await db.query(
      "authenticated",
      adminId,
      "select public.admin_update_address($1,$2,$3,$4,$5,$6,$7,$8)",
      [qr.id, a.recipient_name, a.postal_code, a.prefecture, a.city, a.address_line, a.building, a.phone],
    );
    expect((await qrRow(qr.id)).status).toBe("used");
    const { rows } = await db.pool.query("select status from public.shipments where qr_code_id = $1", [qr.id]);
    expect(rows[0].status).toBe("pending");
  });
});

describe("ダッシュボード集計", () => {
  it("各状態の件数を返す", async () => {
    const local = await createTestDb();
    try {
      const admin = await createAdmin(local);
      const a = await issue(local, admin); // unused
      const b = await issue(local, admin); // used + pending
      const c = await issue(local, admin); // used + shipped
      const d = await issue(local, admin); // revoked
      void a;
      await redeem(local, b.hash);
      await redeem(local, c.hash);
      await local.query("authenticated", admin, "select public.mark_shipped($1)", [c.id]);
      await local.query("authenticated", admin, "select public.revoke_qr_code($1)", [d.id]);
      const { rows } = await local.query("authenticated", admin, "select public.admin_dashboard_counts() as c");
      expect(rows[0].c).toEqual({ total: 4, awaiting_address: 1, awaiting_shipment: 1, shipped: 1, revoked: 1 });
    } finally {
      await local.close();
    }
  });
});

describe("操作履歴", () => {
  it("追記専用で UPDATE / DELETE できない", async () => {
    await expect(db.pool.query("update public.audit_logs set action = 'qr.issue'")).rejects.toThrow(/append-only/);
    await expect(db.pool.query("delete from public.audit_logs")).rejects.toThrow(/append-only/);
  });
});

describe("レート制限", () => {
  it("ウィンドウ内の上限を超えると false", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const { rows } = await db.query<{ ok: boolean }>(
        "service_role",
        null,
        "select public.check_rate_limit($1, 3, 86400) as ok",
        ["test-key"],
      );
      results.push(rows[0].ok);
    }
    expect(results).toEqual([true, true, true, false]);
  });
});
