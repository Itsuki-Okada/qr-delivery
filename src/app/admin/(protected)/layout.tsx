"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useState } from "react";
import { getBackend, type Admin } from "@/lib/backend";
import { Loading } from "@/components/ui";

const NAV = [
  { href: "/admin/", label: "ダッシュボード" },
  { href: "/admin/qr/new/", label: "QRコード発行" },
  { href: "/admin/qr/", label: "QRコード一覧" },
  { href: "/admin/addresses/", label: "住所管理" },
  { href: "/admin/shipments/", label: "発送管理" },
  { href: "/admin/audit/", label: "操作履歴" },
];

const AdminContext = createContext<Admin | null>(null);
export function useAdmin() {
  return use(AdminContext);
}

// 画面表示のためのログイン確認。データへのアクセス権限は Supabase の RLS / DB 関数が判定する
// （ここを回避しても管理データは取得できない）。
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<Admin | null>(null);

  useEffect(() => {
    getBackend()
      .getCurrentAdmin()
      .then((a) => (a ? setAdmin(a) : router.replace("/admin/login/")))
      .catch(() => router.replace("/admin/login/"));
  }, [router]);

  async function logout() {
    await getBackend().signOut();
    router.replace("/admin/login/");
  }

  if (!admin) return <Loading label="ログイン状態を確認しています…" />;

  return (
    <AdminContext value={admin}>
      <div className="flex min-h-screen flex-col">
        <header className="no-print border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
            <Link href="/admin/" className="font-bold">
              QRコード配送管理
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-slate-700 hover:text-slate-950 hover:underline">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span className="text-slate-500">{admin.displayName}</span>
              <button type="button" onClick={logout} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">
                ログアウト
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
      </div>
    </AdminContext>
  );
}
