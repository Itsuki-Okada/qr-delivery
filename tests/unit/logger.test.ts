import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, redact, REDACTED } from "@/lib/logger";
import { createHash } from "node:crypto";
import { generateToken } from "@/lib/token";

afterEach(() => vi.restoreAllMocks());

function captureConsole() {
  const lines: string[] = [];
  for (const m of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
  return lines;
}

describe("ログのマスキング", () => {
  const token = generateToken();
  const hash = createHash("sha256").update(token).digest("hex");

  it("トークン・ハッシュ・QR URL を文字列中からマスクする", () => {
    const out = JSON.stringify(
      redact({ message: `GET https://example.com/redeem/${token} url=https://example.com/redeem/#${token} hash=${hash} raw=${token}` }),
    );
    expect(out).not.toContain(token);
    expect(out).not.toContain(hash);
    expect(out).toContain("/redeem/[REDACTED]");
  });

  it("個人情報・認証情報のキーは値ごとマスクする", () => {
    const out = redact({
      recipient_name: "山田太郎",
      phone: "09012345678",
      postal_code: "100-0001",
      address_line: "千代田1-1",
      email: "a@example.com",
      password: "pw",
      token: "t",
      redeemUrl: "https://x",
      ip: "203.0.113.1",
      qrCodeId: "00000000-0000-0000-0000-000000000000",
    }) as Record<string, unknown>;
    for (const k of ["recipient_name", "phone", "postal_code", "address_line", "email", "password", "token", "redeemUrl", "ip"]) {
      expect(out[k]).toBe(REDACTED);
    }
    expect(out.qrCodeId).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("エラーは name と code だけを出力する（DB エラーの detail に入力値が含まれ得るため）", () => {
    const err = Object.assign(new Error('new row violates check constraint, Failing row contains (山田太郎, 09012345678)'), {
      code: "23514",
      details: "Failing row contains (山田太郎, 09012345678)",
    });
    const lines = captureConsole();
    logger.error("redeem.failed", { error: err });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("23514");
    expect(lines[0]).not.toContain("山田太郎");
    expect(lines[0]).not.toContain("09012345678");
  });

  it("PostgREST 形式のエラーオブジェクトも message/details を出さない", () => {
    const lines = captureConsole();
    logger.error("x", { error: { code: "P0001", message: `token ${token}`, details: "09012345678", hint: null } });
    expect(lines[0]).toContain("P0001");
    expect(lines[0]).not.toContain(token);
    expect(lines[0]).not.toContain("09012345678");
  });
});
