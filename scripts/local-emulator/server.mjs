// ローカル検証用 Supabase エミュレーター（開発専用。本番では使用しない）
// 使い方: npm run emulator   （ポート 54321 で待ち受け。DB は .local/pgdata に保存）
// .env.local に NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 と seed.json の publishable キーを設定して npm run dev。

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { startEmulator } from "./emulator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const seed = JSON.parse(readFileSync(path.join(ROOT, "scripts/local-emulator/seed.json"), "utf8"));
const HTTP_PORT = Number(process.env.EMULATOR_PORT ?? 54321);
const PG_PORT = Number(process.env.EMULATOR_PG_PORT ?? 54322);
const DATA_DIR = path.join(ROOT, ".local/pgdata");

const fresh = !existsSync(path.join(DATA_DIR, "PG_VERSION"));
mkdirSync(path.dirname(DATA_DIR), { recursive: true });
const embedded = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PG_PORT,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});
if (fresh) await embedded.initialise();
await embedded.start();

const pool = new pg.Pool({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`, max: 20 });
if (fresh) {
  await pool.query(readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8"));
  const dir = path.join(ROOT, "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(dir, f), "utf8"));
    console.log(`migration applied: ${f}`);
  }
}

const emulator = await startEmulator({ pool, port: HTTP_PORT, seed });
console.log(`local supabase emulator: ${emulator.url} (postgres :${PG_PORT})`);

async function shutdown() {
  await emulator.close();
  await pool.end().catch(() => {});
  await embedded.stop().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
