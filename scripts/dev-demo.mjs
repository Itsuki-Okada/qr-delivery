// デモモード（Supabase なし）で開発サーバーを起動する
import { spawn } from "node:child_process";

const child = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NEXT_PUBLIC_DEMO_MODE: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
