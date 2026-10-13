import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseBackend } from "@/lib/backend/supabase";
import { defineBackendContract } from "../contract/backend-contract";
import { createTestDb } from "./helpers";
import { startEmulator } from "../../scripts/local-emulator/emulator.mjs";

const seed = JSON.parse(readFileSync(path.resolve(__dirname, "../../scripts/local-emulator/seed.json"), "utf8"));

defineBackendContract("Supabase（supabase-js → エミュレーター → 実 PostgreSQL）", async () => {
  const db = await createTestDb();
  const emulator = await startEmulator({ pool: db.pool, port: 0 || 56000 + Math.floor(Math.random() * 3000), seed });
  const memory = new Map<string, string>();
  let n = 0;
  const client = createClient(emulator.url, seed.keys.publishable, {
    auth: {
      storage: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
        removeItem: (k: string) => void memory.delete(k),
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      // レート制限は DB テストで個別に検証するため、ここでは別々の利用者として送信する
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        n += 1;
        headers.set("cf-connecting-ip", `192.0.2.${n % 250}`);
        return fetch(input, { ...init, headers });
      },
    },
  });
  const [admin] = seed.admins;
  const [nonAdmin] = seed.non_admins;
  return {
    backend: createSupabaseBackend(client),
    admin: { email: admin.email, password: admin.password, displayName: admin.display_name },
    nonAdmin: { email: nonAdmin.email, password: nonAdmin.password },
    cleanup: async () => {
      await emulator.close();
      await db.close();
    },
  };
});
