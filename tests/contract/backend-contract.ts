import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NotAuthorizedError, type Backend } from "@/lib/backend/types";
import { generateToken } from "@/lib/token";
import type { Address } from "@/lib/validation/address";

// Supabase 版とデモ版の Backend が同じ業務ルールを満たすことを確認する共通テスト。

export interface ContractEnv {
  backend: Backend;
  admin: { email: string; password: string; displayName: string };
  /** Auth には存在するが管理者ではないユーザー（デモには存在しない） */
  nonAdmin?: { email: string; password: string };
  cleanup?: () => Promise<void>;
}

const address: Address = {
  recipient_name: "契約 太郎",
  postal_code: "100-0001",
  prefecture: "東京都",
  city: "千代田区",
  address_line: "千代田1-1",
  building: "契約ビル 202",
  phone: "09011112222",
};

export function defineBackendContract(name: string, setup: () => Promise<ContractEnv>) {
  describe(`Backend 契約テスト: ${name}`, () => {
    let env: ContractEnv;
    let b: Backend;
    const logged: string[] = [];

    beforeAll(async () => {
      env = await setup();
      b = env.backend;
      for (const m of ["log", "info", "warn", "error", "debug"] as const) {
        vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
          logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        });
      }
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      await env.cleanup?.();
    });

    const login = async () => {
      const r = await b.signIn(env.admin.email, env.admin.password);
      expect(r.ok).toBe(true);
    };

    describe("管理者認証", () => {
      afterEach(async () => {
        await b.signOut();
      });

      it("未ログインでは管理者情報が取れず、管理操作はすべて拒否される", async () => {
        expect(await b.getCurrentAdmin()).toBeNull();
        const ops: (() => Promise<unknown>)[] = [
          () => b.getDashboardCounts(),
          () => b.listQrCodes({}),
          () => b.issueQrCode(),
          () => b.listAddresses({}),
          () => b.listShipments({ status: "pending" }),
          () => b.listAuditLogs({}),
          () => b.markShipped("00000000-0000-4000-8000-000000000000"),
          () => b.revokeQrCode("00000000-0000-4000-8000-000000000000"),
          () => b.updateAddress("00000000-0000-4000-8000-000000000000", address),
        ];
        for (const op of ops) await expect(op()).rejects.toBeInstanceOf(NotAuthorizedError);
      });

      it("パスワード誤りは汎用メッセージで拒否", async () => {
        const r = await b.signIn(env.admin.email, "wrong-password");
        expect(r).toEqual({ ok: false, message: "メールアドレスまたはパスワードが正しくありません。" });
        expect(await b.getCurrentAdmin()).toBeNull();
      });

      it("管理者でない Auth ユーザーはログインできない", async () => {
        if (!env.nonAdmin) return;
        const r = await b.signIn(env.nonAdmin.email, env.nonAdmin.password);
        expect(r.ok).toBe(false);
        expect(await b.getCurrentAdmin()).toBeNull();
        await expect(b.getDashboardCounts()).rejects.toBeInstanceOf(NotAuthorizedError);
      });

      it("管理者はログインでき、ログアウト後は再び拒否される", async () => {
        await login();
        expect((await b.getCurrentAdmin())?.displayName).toBe(env.admin.displayName);
        await b.signOut();
        expect(await b.getCurrentAdmin()).toBeNull();
        await expect(b.issueQrCode()).rejects.toBeInstanceOf(NotAuthorizedError);
      });
    });

    describe("業務フロー（発行 → 住所登録 → 使用済み → 発送済み）", () => {
      beforeAll(login);
      afterAll(() => b.signOut());

      it("一連の流れ", async () => {
        const before = await b.getDashboardCounts();

        // 1. 発行（トークンは 256bit、1 度だけ返る）
        const qr = await b.issueQrCode();
        expect(qr.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect((await b.getQrOverview(qr.id))?.status).toBe("unused");

        // 2. 顧客が読み取る（ログイン不要）→ 未使用
        await b.signOut();
        expect(await b.redeemStatus(qr.token)).toBe("unused");

        // 3. 住所登録 → 成功と同時に使用済み
        expect(await b.redeemSubmit(qr.token, address)).toEqual({ status: "ok" });
        expect(await b.redeemStatus(qr.token)).toBe("used");

        // 4. 同じ QR から再登録できない
        expect(await b.redeemSubmit(qr.token, { ...address, recipient_name: "別人" })).toEqual({ status: "used" });

        // 5. 管理者が住所を確認
        await login();
        const pending = await b.listShipments({ status: "pending" });
        const item = pending.items.find((i) => i.qr.id === qr.id);
        expect(item?.address.recipient_name).toBe(address.recipient_name);
        expect(item?.address.phone).toBe(address.phone);

        // 6. 発送済み（二重登録は不可）。QR の状態は used のまま
        expect(await b.markShipped(qr.id)).toBe("ok");
        expect(await b.markShipped(qr.id)).toBe("already_shipped");
        const after = await b.getQrOverview(qr.id);
        expect(after).toMatchObject({ status: "used", shipment_status: "shipped" });
        expect(after?.shipped_at).toBeTruthy();
        expect(after?.shipped_by).toBe((await b.getCurrentAdmin())?.id);

        // 7. 集計
        const counts = await b.getDashboardCounts();
        expect(counts.total).toBe(before.total + 1);
        expect(counts.shipped).toBe(before.shipped + 1);
        expect(counts.awaiting_shipment).toBe(before.awaiting_shipment);
      });

      it("同時送信（10並列）でも登録は1件だけ成功", async () => {
        const qr = await b.issueQrCode();
        const results = await Promise.all(
          Array.from({ length: 10 }, (_, i) => b.redeemSubmit(qr.token, { ...address, recipient_name: `同時${i}` })),
        );
        expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
        expect(results.filter((r) => r.status === "used")).toHaveLength(9);
      });

      it("不正なトークン（存在しない・形式不正）を拒否", async () => {
        expect(await b.redeemStatus(generateToken())).toBe("invalid");
        expect(await b.redeemStatus("abc")).toBe("invalid");
        expect(await b.redeemSubmit(generateToken(), address)).toEqual({ status: "invalid" });
      });

      it("サーバー側でも入力値を検証する（画面の検証を回避した送信）", async () => {
        const qr = await b.issueQrCode();
        const r = await b.redeemSubmit(qr.token, { ...address, postal_code: "1", phone: "abc" } as Address);
        expect(r.status).toBe("validation");
        expect(r.status === "validation" && [...r.fields].sort()).toEqual(["phone", "postal_code"]);
        expect(await b.redeemStatus(qr.token)).toBe("unused");
      });

      it("無効化: 未使用のみ可能、無効化後は登録を拒否、元に戻せない", async () => {
        const qr = await b.issueQrCode();
        expect(await b.revokeQrCode(qr.id)).toBe("ok");
        expect(await b.revokeQrCode(qr.id)).toBe("not_unused");
        expect(await b.redeemStatus(qr.token)).toBe("revoked");
        expect(await b.redeemSubmit(qr.token, address)).toEqual({ status: "revoked" });
        const o = await b.getQrOverview(qr.id);
        expect(o?.revoked_by).toBe((await b.getCurrentAdmin())?.id);

        const used = await b.issueQrCode();
        await b.redeemSubmit(used.token, address);
        expect(await b.revokeQrCode(used.id)).toBe("not_unused");
      });

      it("住所修正: 修正者・日時・変更項目名を記録し、値は履歴に残さない", async () => {
        const qr = await b.issueQrCode();
        await b.redeemSubmit(qr.token, address);
        expect(await b.updateAddress(qr.id, address)).toBe("no_change");
        expect(await b.updateAddress(qr.id, { ...address, city: "港区", building: "" })).toBe("ok");
        const d = await b.getAddressDetail(qr.id);
        expect(d?.address).toMatchObject({ city: "港区", building: null });
        expect(d?.address?.updated_by).toBe((await b.getCurrentAdmin())?.id);
        const log = d?.history.find((h) => h.action === "address.update");
        expect(log?.metadata.changed_fields).toEqual(["city", "building"]);
        expect(JSON.stringify(d?.history)).not.toContain("港区");
        expect(d?.qr.status).toBe("used");
        expect(d?.qr.shipment_status).toBe("pending");
      });

      it("一覧の絞り込み・識別番号検索", async () => {
        const qr = await b.issueQrCode();
        const check = async (filter: "unused" | "used" | "pending" | "shipped" | "revoked") => {
          const { rows } = await b.listQrCodes({ filter });
          expect(rows.length).toBeGreaterThan(0);
          for (const r of rows) {
            if (filter === "pending" || filter === "shipped") expect(r.shipment_status).toBe(filter);
            else expect(r.status).toBe(filter);
          }
        };
        for (const f of ["unused", "used", "pending", "shipped", "revoked"] as const) await check(f);
        const found = await b.listQrCodes({ serial: qr.serial_no });
        expect(found.rows.map((r) => r.id)).toEqual([qr.id]);
        expect((await b.listAddresses({})).items.every((i) => i.qr.status === "used")).toBe(true);
      });

      it("操作履歴に発行・登録・発送・無効化・修正が残り、トークンや個人情報を含まない", async () => {
        const { rows } = await b.listAuditLogs({});
        const actions = new Set(rows.map((r) => r.action));
        for (const a of ["qr.issue", "address.register", "shipment.mark_shipped", "qr.revoke", "address.update"]) {
          expect(actions.has(a as never)).toBe(true);
        }
        const dump = JSON.stringify(rows);
        for (const secret of [address.recipient_name, address.phone, address.address_line, address.postal_code]) {
          expect(dump).not.toContain(secret);
        }
        expect(dump).not.toMatch(/[A-Za-z0-9_-]{43}/);
      });

      it("どの処理でもトークン・個人情報をコンソールに出力しない", () => {
        const all = logged.join("\n");
        for (const secret of [address.recipient_name, address.phone, address.address_line]) {
          expect(all).not.toContain(secret);
        }
        expect(all).not.toMatch(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/);
      });
    });
  });
}
