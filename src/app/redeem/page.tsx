"use client";

import { useCallback, useEffect, useState } from "react";
import { getBackend, type RedeemStatus } from "@/lib/backend";
import { tokenFromHash } from "@/lib/token";
import { Loading } from "@/components/ui";
import { RedeemFlow } from "./RedeemFlow";
import { RedeemMessage } from "./RedeemMessage";

type MessageKind = Exclude<RedeemStatus, "unused"> | "network" | "no_token" | "demo_foreign";
type PageState =
  | { kind: "loading" }
  | { kind: "form"; token: string }
  | { kind: "message"; status: MessageKind; token?: string };

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

// QR の URL は /redeem/#<token>。# 以降はサーバーに送信されないため、Web サーバーのログに残らない。
export default function RedeemPage() {
  const [state, setState] = useState<PageState>({ kind: "loading" });

  const check = useCallback(async () => {
    const hash = window.location.hash;
    const token = tokenFromHash(hash);
    if (!token) {
      // # 以降がない（読み取りアプリが URL の一部を落とした等）と、形式が不正な場合を区別する
      setState({ kind: "message", status: hash.length > 1 ? "invalid" : "no_token" });
      return;
    }
    try {
      const status = await getBackend().redeemStatus(token);
      if (status === "unused") setState({ kind: "form", token });
      else if (status === "invalid" && IS_DEMO) setState({ kind: "message", status: "demo_foreign", token });
      else setState({ kind: "message", status });
    } catch {
      setState({ kind: "message", status: "network" });
    }
  }, []);

  useEffect(() => {
    // 初回表示と、同じページ内で # が変わった場合に確認する
    const run = () => void check();
    const timer = setTimeout(run, 0);
    window.addEventListener("hashchange", run);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", run);
    };
  }, [check]);

  async function tryOnThisDevice(token: string) {
    setState({ kind: "loading" });
    await getBackend().adoptForeignToken?.(token);
    await check();
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6 sm:py-10">
      {state.kind === "loading" && <Loading label="QRコードを確認しています…" />}
      {state.kind === "form" && <RedeemFlow token={state.token} />}
      {state.kind === "message" && (
        <RedeemMessage kind={state.status}>
          {state.status === "demo_foreign" && state.token && (
            <button
              type="button"
              onClick={() => tryOnThisDevice(state.token!)}
              className="mt-6 w-full rounded-xl bg-slate-900 py-4 text-base font-bold text-white"
            >
              この端末で顧客画面を体験する
            </button>
          )}
        </RedeemMessage>
      )}
    </main>
  );
}
