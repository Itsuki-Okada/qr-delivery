// RFC 6238 TOTP（認証アプリの 6 桁コード）。Web Crypto（HMAC-SHA1）で実装。
// 本番（Firebase）では TOTP の検証は Firebase Authentication が行う。ここはデモとテストで使う。

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = BASE32.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** 認証アプリ登録用の秘密鍵（160 ビット） */
export function generateTotpSecret(): string {
  return base32Encode(globalThis.crypto.getRandomValues(new Uint8Array(20)));
}

export async function hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export async function totp(secretBase32: string, timeMs = Date.now(), digits = 6, stepSeconds = 30) {
  return hotp(base32Decode(secretBase32), Math.floor(timeMs / 1000 / stepSeconds), digits);
}

/** 前後 1 ステップ（±30 秒）の時刻ずれを許容して検証する */
export async function verifyTotp(secretBase32: string, code: string, timeMs = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  for (const drift of [0, -1, 1]) {
    if ((await totp(secretBase32, timeMs + drift * 30_000)) === code) return true;
  }
  return false;
}

export function otpauthUrl(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
