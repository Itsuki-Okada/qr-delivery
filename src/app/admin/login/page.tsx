import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "管理者ログイン" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold">管理者ログイン</h1>
        <p className="mt-1 text-sm text-slate-500">QRコード配送管理</p>
        <LoginForm />
      </div>
    </main>
  );
}
