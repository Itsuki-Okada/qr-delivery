import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildRedeemUrl, generateToken, hashToken, isWellFormedToken, tokenFromHash, TOKEN_BYTES } from "@/lib/token";

describe("トークン", () => {
  it("256ビット（32バイト）の base64url 文字列を生成する", () => {
    const t = generateToken();
    expect(TOKEN_BYTES * 8).toBe(256);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
  });

  it("毎回異なり、連番や予測可能な値にならない", () => {
    const set = new Set(Array.from({ length: 5000 }, generateToken));
    expect(set.size).toBe(5000);
  });

  it("SHA-256 の16進64文字（DB の private.hash_token・Node の crypto と同じ結果）", async () => {
    expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const t = generateToken();
    expect(await hashToken(t)).toBe(createHash("sha256").update(t).digest("hex"));
  });

  it("形式の検証", () => {
    expect(isWellFormedToken(generateToken())).toBe(true);
    for (const bad of ["", "abc", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}!`, null, 123, "../../etc/passwd"]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });

  it("QR の URL はトークンをフラグメント（#）に置き、サーバーへ送信されないようにする", () => {
    const t = generateToken();
    const url = buildRedeemUrl("https://example.com", t);
    expect(url).toBe(`https://example.com/redeem/#${t}`);
    // フラグメントは HTTP リクエストのパスに含まれない
    expect(new URL(url).pathname).toBe("/redeem/");
    expect(new URL(url).search).toBe("");
    expect(buildRedeemUrl("https://user.github.io/repo/", t)).toBe(`https://user.github.io/repo/redeem/#${t}`);
    expect(() => buildRedeemUrl("https://example.com", "bad")).toThrow();
  });

  it("location.hash からトークンを取り出す", () => {
    const t = generateToken();
    expect(tokenFromHash(`#${t}`)).toBe(t);
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#abc")).toBeNull();
  });
});
