/**
 * アプリケーションログ。個人情報・トークン・認証情報を出力しないため、
 * - 機微なキー名の値はマスクする
 * - 文字列中のトークン形式（base64url 43文字・SHA-256 16進・JWT）と /redeem/<token> をマスクする
 * - Error は name / code のみ出力する（DB エラーの message / details には入力値が含まれ得るため）
 */
type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SENSITIVE_KEY =
  /(token|hash|password|secret|authorization|cookie|session|recipient|phone|postal|address|city|building|prefecture|email|url|^ip$|ip_address)/i;

const SENSITIVE_PATTERNS: RegExp[] = [
  /\/redeem\/[^\s"'?#/]+/g, // QR URL のパス
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /\b[0-9a-f]{64}\b/gi, // SHA-256
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, // 256bit base64url トークン
];

export const REDACTED = "[REDACTED]";

export function redactString(s: string): string {
  let out = s;
  for (const p of SENSITIVE_PATTERNS) {
    out = out.replace(p, (m) => (m.startsWith("/redeem/") ? `/redeem/${REDACTED}` : REDACTED));
  }
  return out;
}

function serializeError(e: unknown): Fields {
  if (e && typeof e === "object") {
    const o = e as { name?: unknown; code?: unknown };
    return {
      name: typeof o.name === "string" ? o.name : "Error",
      ...(typeof o.code === "string" || typeof o.code === "number" ? { code: String(o.code) } : {}),
    };
  }
  return { name: typeof e };
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[...]";
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "error" || k === "err") out[k] = serializeError(v);
      else out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level: Level, event: string, fields: Fields = {}) {
  const line = JSON.stringify({
    level,
    event: redactString(event),
    time: new Date().toISOString(),
    ...(redact(fields) as Fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};

export type Logger = typeof logger;
