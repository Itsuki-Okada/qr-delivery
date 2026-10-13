import { createDemoBackend, DEMO_ACCOUNTS, type KeyValueStorage } from "@/lib/backend/demo";
import { defineBackendContract } from "../contract/backend-contract";

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

defineBackendContract("デモ（ブラウザ内保存）", async () => ({
  backend: createDemoBackend({ data: memoryStorage(), session: memoryStorage() }),
  admin: { email: DEMO_ACCOUNTS[0].email, password: DEMO_ACCOUNTS[0].password, displayName: DEMO_ACCOUNTS[0].displayName },
}));

import { describe, expect, it } from "vitest";
import { generateToken } from "@/lib/token";
import type { Address } from "@/lib/validation/address";

describe("デモ: 別端末で発行された QR の受け入れ", () => {
  const sample: Address = {
    recipient_name: "体験 太郎",
    postal_code: "100-0001",
    prefecture: "東京都",
    city: "千代田区",
    address_line: "千代田1-1",
    building: "",
    phone: "09000000000",
  };

  it("発行元にない QR は invalid。受け入れると未使用になり、登録すると使用済みになる", async () => {
    const phone = createDemoBackend({ data: memoryStorage(), session: memoryStorage() });
    const token = generateToken(); // PC で発行された（この端末には存在しない）トークン
    expect(await phone.redeemStatus(token)).toBe("invalid");
    expect(await phone.adoptForeignToken(token)).toBe(true);
    expect(await phone.redeemStatus(token)).toBe("unused");
    expect(await phone.redeemSubmit(token, sample)).toEqual({ status: "ok" });
    expect(await phone.redeemStatus(token)).toBe("used");
    // 既にある QR は受け入れ直さない（使用済みが未使用に戻ることはない）
    expect(await phone.adoptForeignToken(token)).toBe(false);
    expect(await phone.redeemStatus(token)).toBe("used");
  });

  it("形式が不正なトークンは受け入れない", async () => {
    const phone = createDemoBackend({ data: memoryStorage(), session: memoryStorage() });
    expect(await phone.adoptForeignToken("abc")).toBe(false);
  });
});
