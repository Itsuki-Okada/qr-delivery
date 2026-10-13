"use client";

import { getBackend } from "@/lib/backend";

export function DemoBanner() {
  function reset() {
    if (!confirm("デモデータを初期状態に戻します。よろしいですか？")) return;
    getBackend().reset?.();
    window.location.reload();
  }
  return (
    <div className="no-print border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
      <strong>デモモード</strong>：データはこのブラウザ内にのみ保存され、外部には送信されません。
      顧客画面はQRを発行したのと同じブラウザで開いてください。
      <button type="button" onClick={reset} className="ml-2 underline">
        デモデータをリセット
      </button>
    </div>
  );
}
