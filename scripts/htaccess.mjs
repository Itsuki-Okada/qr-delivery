// Xserver（Apache）用の .htaccess。静的ファイルにセキュリティヘッダーを付与する。
export function buildHtaccess({ supabaseUrl, basePath = "" }) {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  return `# 自動生成: scripts/htaccess.mjs（直接編集しないこと）
Options -Indexes
DirectoryIndex index.html
ErrorDocument 404 ${basePath}/404.html

# HTTPS へ統一
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} off
  RewriteCond %{HTTP:X-Forwarded-Proto} !https
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
</IfModule>

<IfModule mod_headers.c>
  Header always set Content-Security-Policy "${csp}"
  Header always set Referrer-Policy "no-referrer"
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  Header always set X-Robots-Tag "noindex, nofollow"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  Header always set Cross-Origin-Opener-Policy "same-origin"
  Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains"

  # HTML は常に最新を取得（デプロイ直後に古い画面が残らないように）
  <FilesMatch "\\.html$">
    Header set Cache-Control "no-cache, no-store, must-revalidate"
  </FilesMatch>
  # ハッシュ付きの静的アセットは長期キャッシュ
  <If "%{REQUEST_URI} =~ m#/_next/static/#">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </If>
</IfModule>

# 隠しファイル（.htaccess 以外の .env 等）へのアクセスを拒否
<FilesMatch "^\\.">
  Require all denied
</FilesMatch>
`;
}
