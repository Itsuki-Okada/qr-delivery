"use client";

import { useState } from "react";
import { getBackend } from "@/lib/backend";
import { buttonPrimary } from "@/components/ui";

const MESSAGES = { already_shipped: "既に発送済みです。", not_found: "発送対象が見つかりません。" } as const;

export function ShipButton({ qrCodeId, serialLabel, onDone }: { qrCodeId: string; serialLabel: string; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    if (pending || !confirm(`${serialLabel} を発送済みにします。よろしいですか？`)) return;
    setPending(true);
    try {
      const r = await getBackend().markShipped(qrCodeId);
      if (r === "ok") onDone();
      else setMessage(MESSAGES[r]);
    } catch {
      setMessage("通信エラーが発生しました。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={onClick} disabled={pending} className={buttonPrimary}>
        {pending ? "処理中…" : "発送済みにする"}
      </button>
      {message && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {message}
        </p>
      )}
    </div>
  );
}
