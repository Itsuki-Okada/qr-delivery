import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    pgPort: number;
  }
}

const ROOT = path.resolve(__dirname, "../..");
export const TEMPLATE_DB = "qr_template";

// 実 PostgreSQL を起動し、Supabase シム＋全マイグレーションを適用したテンプレート DB を作る。
// 各テストファイルはこのテンプレートから独立したデータベースを複製して使う。
export default async function setup(project: TestProject) {
  const dir = mkdtempSync(path.join(tmpdir(), "qr-delivery-pg-"));
  const port = 55000 + Math.floor(Math.random() * 5000);
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(dir, "data"),
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    // Supabase と同じ UTF-8（日本語の文字数チェックをバイト数で誤判定しないため）
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(TEMPLATE_DB);

  const client = pg.getPgClient(TEMPLATE_DB);
  await client.connect();
  try {
    await client.query(readFileSync(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8"));
    const migrationsDir = path.join(ROOT, "supabase/migrations");
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
      try {
        await client.query(readFileSync(path.join(migrationsDir, file), "utf8"));
      } catch (e) {
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }

  project.provide("pgPort", port);

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
