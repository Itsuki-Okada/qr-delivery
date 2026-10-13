"use client";

import { DEMO_ACCOUNTS } from "@/lib/backend/demo";

export default function DemoLoginHint({ onFill }: { onFill: (email: string, password: string) => void }) {
  const [account] = DEMO_ACCOUNTS;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      デモ用アカウント：
      <button type="button" className="ml-1 underline" onClick={() => onFill(account.email, account.password)}>
        入力する
      </button>
      <div className="mt-1 font-mono">
        {account.email} / {account.password}
      </div>
    </div>
  );
}
