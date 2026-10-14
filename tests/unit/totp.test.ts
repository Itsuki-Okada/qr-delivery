import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUrl, totp, verifyTotp } from "@/lib/totp";

// RFC 4226 / RFC 6238 のテストベクター（秘密鍵 "12345678901234567890"）
const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));

describe("TOTP", () => {
  it("base32 の往復", () => {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("RFC 4226 HOTP ベクター", async () => {
    const secret = new TextEncoder().encode("12345678901234567890");
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    for (let i = 0; i < expected.length; i++) expect(await hotp(secret, i)).toBe(expected[i]);
  });

  it("RFC 6238 TOTP ベクター（SHA-1, 8 桁）", async () => {
    expect(await totp(RFC_SECRET, 59_000, 8)).toBe("94287082");
    expect(await totp(RFC_SECRET, 1_111_111_109_000, 8)).toBe("07081804");
    expect(await totp(RFC_SECRET, 20_000_000_000_000, 8)).toBe("65353130");
  });

  it("±30 秒のずれまで受け付け、それ以外・形式不正は拒否", async () => {
    const s = generateTotpSecret();
    const now = 1_800_000_000_000;
    const code = await totp(s, now);
    expect(await verifyTotp(s, code, now)).toBe(true);
    expect(await verifyTotp(s, code, now + 30_000)).toBe(true);
    expect(await verifyTotp(s, code, now + 95_000)).toBe(false);
    expect(await verifyTotp(s, "12345", now)).toBe(false);
    expect(await verifyTotp(s, "abcdef", now)).toBe(false);
  });

  it("認証アプリ登録用 URL", () => {
    const url = otpauthUrl("ABC", "admin@example.com", "QRコード配送管理");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("secret=ABC");
    expect(url).toContain("period=30");
  });
});
