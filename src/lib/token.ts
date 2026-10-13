// ブラウザ・Node.js（v20 以降）共通の Web Crypto を使用する。
// 本番（Supabase）ではトークンの生成・照合は DB 関数が行い、この実装はデモと検証に使う。

/** 256 ビット = 32 バイト */
export const TOKEN_BYTES = 32;
/** 32 バイトを base64url（パディングなし）にすると 43 文字 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 暗号学的に安全な乱数から 256 ビットのトークンを生成する */
export function generateToken(): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** SHA-256（16進小文字 64 文字）。DB の private.hash_token と同じ結果になる */
export async function hashToken(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isWellFormedToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * QR コードに埋め込む URL。トークンは URL フラグメント（# 以降）に置く。
 * フラグメントはブラウザからサーバーへ送信されないため、Web サーバーのアクセスログや
 * Referer にトークンが残らない。
 */
export function buildRedeemUrl(siteBaseUrl: string, token: string): string {
  if (!isWellFormedToken(token)) throw new Error("invalid token");
  const base = siteBaseUrl.endsWith("/") ? siteBaseUrl : `${siteBaseUrl}/`;
  return `${new URL("redeem/", base).toString()}#${token}`;
}

/** location.hash（"#xxxx"）からトークンを取り出す */
export function tokenFromHash(hash: string): string | null {
  const t = hash.replace(/^#/, "");
  return isWellFormedToken(t) ? t : null;
}
