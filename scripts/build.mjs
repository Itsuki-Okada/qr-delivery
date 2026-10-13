// 静的サイトのビルド
//   node scripts/build.mjs xserver  … 本番（Supabase 接続）。out/ に .htaccess を出力。FTP で out/ の中身をアップロードする
//   node scripts/build.mjs demo     … デモ（Supabase なし）。GitHub Pages 用に .nojekyll を出力
//
// 環境変数は .env.production.local（xserver）または実行環境から読み込む。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHtaccess } from "./htaccess.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!["xserver", "demo"].includes(target)) {
  console.error("使い方: node scripts/build.mjs <xserver|demo>");
  process.exit(1);
}

function loadEnvFile(file) {
  const p = path.join(ROOT, file);
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

const env = { ...process.env };
if (target === "demo") {
  env.NEXT_PUBLIC_DEMO_MODE = "1";
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
} else {
  Object.assign(env, loadEnvFile(".env.production.local"), process.env);
  env.NEXT_PUBLIC_DEMO_MODE = "";
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
    if (!env[key]) {
      console.error(`${key} が設定されていません（.env.production.local を作成してください。docs/ENV.md 参照）`);
      process.exit(1);
    }
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL.startsWith("https://")) {
    console.error("NEXT_PUBLIC_SUPABASE_URL は https:// で始まる必要があります");
    process.exit(1);
  }
}

const bin = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
const r = spawnSync(bin, ["build"], { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) process.exit(r.status ?? 1);

const out = path.join(ROOT, "out");
if (target === "xserver") {
  writeFileSync(
    path.join(out, ".htaccess"),
    buildHtaccess({ supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, basePath: env.NEXT_PUBLIC_BASE_PATH ?? "" }),
  );
  console.log("\n✓ out/ を Xserver の公開ディレクトリ（例: public_html）にアップロードしてください（.htaccess を含む）");
} else {
  // GitHub Pages の Jekyll 処理で _next/ が無視されないようにする
  writeFileSync(path.join(out, ".nojekyll"), "");
  console.log("\n✓ デモ用の out/ を作成しました（GitHub Pages / 任意の静的ホスティングに配置可能）");
}
