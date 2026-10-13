"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NotAuthorizedError } from "@/lib/backend/types";

/**
 * 非同期でデータを読み込む。未認証（NotAuthorizedError）ならログイン画面へ移動する。
 * deps には文字列・数値などの単純な値を渡すこと（再読み込みの判定に使う）。
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]) {
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([...deps, tick]);
  const [state, setState] = useState<{ key?: string; data?: T; error?: unknown }>({});

  useEffect(() => {
    let cancelled = false;
    fn().then(
      (data) => {
        if (!cancelled) setState({ key, data });
      },
      (error) => {
        if (cancelled) return;
        if (error instanceof NotAuthorizedError) router.replace("/admin/login/");
        setState((s) => ({ key, data: s.data, error }));
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key が依存値をまとめている
  }, [key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const loading = state.key !== key;
  // 読み込み中は直前のデータを表示し続ける
  return { data: state.data, error: loading ? undefined : state.error, loading, reload };
}
