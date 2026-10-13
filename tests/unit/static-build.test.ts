import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { buildHtaccess } from "../../scripts/htaccess.mjs";

describe("静的ホスティング用の設定", () => {
  it("静的書き出し・ディレクトリ形式の URL", () => {
    expect(nextConfig.output).toBe("export");
    expect(nextConfig.trailingSlash).toBe(true);
  });

  it("開発サーバーのリクエスト URL・関数引数のログを無効化", () => {
    expect(nextConfig.logging).toMatchObject({ incomingRequests: false, serverFunctions: false });
  });

  it("本番ビルドではデモ用モジュールをスタブに置き換える", () => {
    expect(nextConfig.turbopack?.resolveAlias).toEqual({ "@/lib/backend/demo": "./src/lib/backend/demo-disabled.ts" });
  });
});

describe("Xserver 用 .htaccess", () => {
  const h: string = buildHtaccess({ supabaseUrl: "https://abc.supabase.co/rest/v1", basePath: "" });

  it("セキュリティヘッダーを付与する", () => {
    expect(h).toContain('Header always set Referrer-Policy "no-referrer"');
    expect(h).toContain('Header always set X-Frame-Options "DENY"');
    expect(h).toContain("Strict-Transport-Security");
    expect(h).toContain("frame-ancestors 'none'");
  });

  it("ブラウザの接続先は自サイトと Supabase のみ", () => {
    expect(h).toMatch(/connect-src 'self' https:\/\/abc\.supabase\.co;/);
  });

  it("HTTPS へリダイレクトし、ディレクトリ一覧と隠しファイルを拒否", () => {
    expect(h).toContain("RewriteCond %{HTTPS} off");
    expect(h).toContain("Options -Indexes");
    expect(h).toMatch(/<FilesMatch "\^\\\.">\s+Require all denied/);
  });

  it("サブディレクトリ配置時の 404 ページ", () => {
    expect(buildHtaccess({ supabaseUrl: "https://abc.supabase.co", basePath: "/qr" })).toContain("ErrorDocument 404 /qr/404.html");
  });
});
