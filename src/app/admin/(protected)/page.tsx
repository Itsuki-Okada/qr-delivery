"use client";

import Link from "next/link";
import { getBackend } from "@/lib/backend";
import { useAsync } from "@/components/useAsync";
import { LoadError, Loading, PageHeader, buttonPrimary } from "@/components/ui";

export default function DashboardPage() {
  const { data: c, error, loading, reload } = useAsync(() => getBackend().getDashboardCounts(), []);
  const cards = c
    ? [
        { label: "QRコード発行総数", value: c.total, href: "/admin/qr/" },
        { label: "住所登録待ち", value: c.awaiting_address, href: "/admin/qr/?filter=unused" },
        { label: "発送待ち", value: c.awaiting_shipment, href: "/admin/shipments/" },
        { label: "発送済み", value: c.shipped, href: "/admin/shipments/?tab=shipped" },
        { label: "無効化", value: c.revoked, href: "/admin/qr/?filter=revoked" },
      ]
    : [];
  return (
    <>
      <PageHeader title="ダッシュボード">
        <Link href="/admin/qr/new/" className={buttonPrimary}>
          QRコードを新規発行
        </Link>
      </PageHeader>
      {loading && !c && <Loading />}
      {error ? <LoadError onRetry={reload} /> : null}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400"
          >
            <div className="text-sm text-slate-500">{card.label}</div>
            <div className="mt-2 text-3xl font-bold tabular-nums">{card.value.toLocaleString("ja-JP")}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
