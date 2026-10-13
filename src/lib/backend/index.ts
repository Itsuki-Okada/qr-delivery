import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";
import { createDemoBackend, type DemoExtras } from "./demo";
import { createSupabaseBackend } from "./supabase";
import type { Backend } from "./types";

export * from "./types";

let instance: (Backend & Partial<DemoExtras>) | undefined;

/** ブラウザ内で共有する Backend（ビルド設定で Supabase / デモを切り替え） */
export function getBackend(): Backend & Partial<DemoExtras> {
  if (instance) return instance;
  // 環境変数を直接比較してビルド時に定数化し、本番ビルドからデモ用コードを除去させる
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") {
    instance = createDemoBackend({ data: window.localStorage, session: window.sessionStorage });
    return instance;
  }
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が設定されていません");
  }
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // タブを閉じるとログアウトされる sessionStorage に保存（共用 PC での残存を防ぐ）
      storage: window.sessionStorage,
      storageKey: "qr-delivery-auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  instance = createSupabaseBackend(client);
  return instance;
}
