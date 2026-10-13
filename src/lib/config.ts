// ビルド時に埋め込まれる公開設定（NEXT_PUBLIC_*）。秘密情報は置かないこと。

/** "1" のとき Supabase を使わないデモモード（データはブラウザ内のみ） */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

/** サブディレクトリに配置する場合のパス（例: GitHub Pages の "/リポジトリ名"）。ルート配置なら空 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
/** Publishable key（旧 anon key）。公開してよい鍵。権限は DB の RLS と関数で制御する */
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * QR に埋め込む URL のベース。NEXT_PUBLIC_SITE_URL があればそれを使い、
 * なければ現在のサイト（管理画面を開いているドメイン＋BASE_PATH）を使う。
 */
export function siteBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured;
  return `${window.location.origin}${BASE_PATH}/`;
}
