import type { NextConfig } from "next";

// 静的ファイル（HTML/CSS/JS）として書き出し、Xserver の共用サーバーや GitHub Pages に置くだけで動かす。
// サーバー側の処理（権限検証・トランザクション）はすべて Supabase の DB 関数で行う。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;
const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

const nextConfig: NextConfig = {
  output: "export",
  // /admin/qr → /admin/qr/index.html として出力（Apache・GitHub Pages でそのまま配信できる）
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  poweredByHeader: false,
  // 開発サーバーの既定ログはリクエスト URL とサーバー関数の引数を出力するため無効化する
  logging: {
    incomingRequests: false,
    serverFunctions: false,
    browserToTerminal: false,
  },
  turbopack: {
    // 本番ビルドではデモ用コード（デモアカウント等）を配布物に含めない
    resolveAlias: isDemo ? {} : { "@/lib/backend/demo": "./src/lib/backend/demo-disabled.ts" },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
