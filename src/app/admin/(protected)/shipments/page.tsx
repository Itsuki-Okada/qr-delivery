"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getBackend, PAGE_SIZE } from "@/lib/backend";
import { formatDateTime, formatSerial } from "@/lib/format";
import { useAsync } from "@/components/useAsync";
import { LoadError, Loading, PageHeader, Pagination, tableClass, tdClass, thClass } from "@/components/ui";
import { ShipButton } from "./ShipButton";

export default function ShipmentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Shipments />
    </Suspense>
  );
}

function Shipments() {
  const sp = useSearchParams();
  const tab = sp.get("tab") === "shipped" ? "shipped" : "pending";
  const page = Number(sp.get("page") ?? "1") || 1;
  const { data, error, loading, reload } = useAsync(async () => {
    const [list, names] = await Promise.all([getBackend().listShipments({ status: tab, page }), getBackend().getAdminNames()]);
    return { ...list, names };
  }, [tab, page]);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader title="発送管理" />
      <div className="mb-4 flex gap-2">
        {(["pending", "shipped"] as const).map((t) => (
          <Link
            key={t}
            href={t === "pending" ? "/admin/shipments/" : "/admin/shipments/?tab=shipped"}
            className={`rounded-full border px-4 py-1.5 text-sm ${t === tab ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}
          >
            {t === "pending" ? "発送待ち" : "発送済み"}
          </Link>
        ))}
      </div>
      {error ? <LoadError onRetry={reload} /> : null}
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-500">{total.toLocaleString("ja-JP")} 件</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>識別番号</th>
                  <th className={thClass}>お届け先</th>
                  <th className={thClass}>電話番号</th>
                  <th className={thClass}>住所登録日時</th>
                  {tab === "shipped" && <th className={thClass}>発送日時 / 操作者</th>}
                  <th className={thClass}>{tab === "pending" ? "操作" : ""}</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ qr, address }) => (
                  <tr key={qr.id}>
                    <td className={`${tdClass} font-mono`}>{formatSerial(qr.serial_no)}</td>
                    <td className={tdClass}>
                      <div className="font-semibold">{address.recipient_name} 様</div>
                      <div>〒{address.postal_code}</div>
                      <div>
                        {address.prefecture}
                        {address.city}
                        {address.address_line}
                      </div>
                      {address.building && <div>{address.building}</div>}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap`}>{address.phone}</td>
                    <td className={tdClass}>{formatDateTime(qr.address_registered_at)}</td>
                    {tab === "shipped" && (
                      <td className={tdClass}>
                        {formatDateTime(qr.shipped_at)}
                        <div className="text-xs text-slate-500">{qr.shipped_by ? data?.names.get(qr.shipped_by) : ""}</div>
                      </td>
                    )}
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {tab === "pending" ? (
                        <ShipButton qrCodeId={qr.id} serialLabel={formatSerial(qr.serial_no)} onDone={reload} />
                      ) : (
                        <Link href={`/admin/addresses/detail/?id=${qr.id}`} className="text-sky-700 hover:underline">
                          詳細
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td className={tdClass} colSpan={6}>
                      {tab === "pending" ? "発送待ちの案件はありません。" : "発送済みの案件はありません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            href={(p) => `/admin/shipments/?${new URLSearchParams({ ...(tab === "shipped" ? { tab } : {}), page: String(p) })}`}
          />
        </>
      )}
    </>
  );
}
