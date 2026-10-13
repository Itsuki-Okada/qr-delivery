"use client";

import { useEffect, useState } from "react";
import { getBackend, type RedeemStatus } from "@/lib/backend";
import { tokenFromHash } from "@/lib/token";
import { Loading } from "@/components/ui";
import { RedeemFlow } from "./RedeemFlow";
import { RedeemMessage } from "./RedeemMessage";

type PageState = { kind: "loading" } | { kind: "form"; token: string } | { kind: "message"; status: Exclude<RedeemStatus, "unused"> | "network" };

// QR の URL は /redeem/#<token>。# 以降はサーバーに送信されないため、Web サーバーのログに残らない。
export default function RedeemPage() {
  const [state, setState] = useState<PageState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const token = tokenFromHash(window.location.hash);
      if (!token) {
        setState({ kind: "message", status: "invalid" });
        return;
      }
      setState({ kind: "loading" });
      try {
        const status = await getBackend().redeemStatus(token);
        if (cancelled) return;
        setState(status === "unused" ? { kind: "form", token } : { kind: "message", status });
      } catch {
        if (!cancelled) setState({ kind: "message", status: "network" });
      }
    }
    check();
    window.addEventListener("hashchange", check);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", check);
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6 sm:py-10">
      {state.kind === "loading" && <Loading label="QRコードを確認しています…" />}
      {state.kind === "form" && <RedeemFlow token={state.token} />}
      {state.kind === "message" && <RedeemMessage kind={state.status} />}
    </main>
  );
}
