"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getBackend, PAGE_SIZE } from "@/lib/backend";
import { formatDateTime, formatSerial, parseSerial } from "@/lib/format";
import { useAsync } from "@/components/useAsync";
import {
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  ShipmentStatusBadge,
  buttonSecondary,
  tableClass,
  tdClass,
  thClass,
} from "@/components/ui";

export default function AddressesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Addresses />
    </Suspense>
  );
}

function Addresses() {
  const router = useRouter();
  const sp = useSearchParams();
  const q = sp.get("q") ?? "";
  const page = Number(sp.get("page") ?? "1") || 1;
  const serial = q.trim() ? parseSerial(q) : null;
  const invalidQuery = q.trim() !== "" && serial === null;
  const { data, error, loading, reload } = useAsync(
    () => (invalidQuery ? Promise.resolve({ items: [], total: 0 }) : getBackend().listAddresses({ page, serial })),
    [q, page],
  );
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader title="住所管理" />
      <form
        key={q}
        onSubmit={(e) => {
          e.preventDefault();
          const v = String(new FormData(e.currentTarget).get("q") ?? "");
          router.push(v ? `/admin/addresses/?q=${encodeURIComponent(v)}` : "/admin/addresses/");
        }}
        className="mb-4 flex items-end gap-3"
      >
        <label className="text-sm">
          <span className="block text-slate-600">識別番号</span>
          <input name="q" defaultValue={q} placeholder="QR-000001" className="mt-1 rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <button type="submit" className={buttonSecondary}>
          検索
        </button>
      </form>
      {invalidQuery && <Notice kind="error">識別番号は「QR-000001」または数字で入力してください。</Notice>}
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
                  <th className={thClass}>氏名</th>
                  <th className={thClass}>住所</th>
                  <th className={thClass}>住所登録日時</th>
                  <th className={thClass}>発送状態</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ qr, address }) => (
                  <tr key={qr.id}>
                    <td className={`${tdClass} font-mono`}>{formatSerial(qr.serial_no)}</td>
                    <td className={tdClass}>{address.recipient_name}</td>
                    <td className={tdClass}>
                      〒{address.postal_code} {address.prefecture}
                      {address.city}
                      {address.address_line}
                      {address.building ? ` ${address.building}` : ""}
                    </td>
                    <td className={tdClass}>{formatDateTime(qr.address_registered_at)}</td>
                    <td className={tdClass}>
                      <ShipmentStatusBadge status={qr.shipment_status} />
                    </td>
                    <td className={tdClass}>
                      <Link href={`/admin/addresses/detail/?id=${qr.id}`} className="whitespace-nowrap text-sky-700 hover:underline">
                        詳細・修正
                      </Link>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td className={tdClass} colSpan={6}>
                      登録済みの住所はありません。
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
            href={(p) => `/admin/addresses/?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`}
          />
        </>
      )}
    </>
  );
}
