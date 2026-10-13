"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getBackend } from "@/lib/backend";
import { buttonPrimary } from "@/components/ui";

// デモビルドでのみ読み込む（本番ビルドには含めない）
const DemoLoginHint = dynamic(() => import("./DemoLoginHint"));

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    getBackend()
      .getCurrentAdmin()
      .then((a) => a && router.replace("/admin/"))
      .catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await getBackend().signIn(email, password);
      if (res.ok) router.replace("/admin/");
      else setError(res.message);
    } catch {
      setError("通信エラーが発生しました。再度お試しください。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      {process.env.NEXT_PUBLIC_DEMO_MODE === "1" && (
        <DemoLoginHint
          onFill={(email, pw) => {
            setEmail(email);
            setPassword(pw);
          }}
        />
      )}
      <label className="block">
        <span className="text-sm font-medium">メールアドレス</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">パスワード</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "ログイン中…" : "ログイン"}
      </button>
    </form>
  );
}
