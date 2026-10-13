import type { Metadata, Viewport } from "next";
import { DemoBanner } from "@/components/DemoBanner";
import { DEMO_MODE, SUPABASE_URL } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "配送先登録",
  robots: { index: false, follow: false },
  // QR のトークンは URL フラグメントにあり Referer には載らないが、念のため Referer 自体を送らない
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// 静的ホスティング（GitHub Pages 等）ではレスポンスヘッダーを設定できないため、CSP を meta でも指定する。
// ブラウザが接続できるのは自サイトと Supabase のみ（外部のアクセス解析等へは送信しない）。
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${!DEMO_MODE && SUPABASE_URL ? ` ${new URL(SUPABASE_URL).origin}` : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        {process.env.NODE_ENV === "production" && <meta httpEquiv="Content-Security-Policy" content={csp} />}
      </head>
      <body className="min-h-full flex flex-col">
        {process.env.NEXT_PUBLIC_DEMO_MODE === "1" && <DemoBanner />}
        {children}
      </body>
    </html>
  );
}
