"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getBackend, PAGE_SIZE, QR_FILTERS, type QrFilter } from "@/lib/backend";
import { formatDateTime, formatSerial, parseSerial } from "@/lib/format";
import { useAsync } from "@/components/useAsync";
import {
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  QrStatusBadge,
  ShipmentStatusBadge,
  buttonPrimary,
  buttonSecondary,
  tableClass,
  tdClass,
  thClass,
} from "@/components/ui";

const FILTER_LABEL: Record<QrFilter, string> = {
  all: "すべて",
  unused: "未使用",
  used: "住所登録済み",
  pending: "発送待ち",
  shipped: "発送済み",
  revoked: "無効化済み",
};

const NOTICES: Record<string, { kind: "success" | "error"; text: string }> = {
  revoked: { kind: "success", text: "QRコードを無効化しました。" },
  revoke_not_unused: { kind: "error", text: "未使用ではないため無効化できませんでした。" },
};

export default function QrListPage() {
  return (
    <Suspense fallback={<Loading />}>
      <QrList />
    </Suspense>
  );
}

function QrList() {
  const router = useRouter();
  const sp = useSearchParams();
  const filterParam = sp.get("filter") ?? "";
  const filter = (QR_FILTERS as readonly string[]).includes(filterParam) ? (filterParam as QrFilter) : "all";
  const q = sp.get("q") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const page = Number(sp.get("page") ?? "1") || 1;
  const notice = NOTICES[sp.get("notice") ?? ""];
  const serial = q.trim() ? parseSerial(q) : null;
  const invalidQuery = q.trim() !== "" && serial === null;

  const { data, error, loading, reload } = useAsync(
    () =>
      invalidQuery
        ? Promise.resolve({ rows: [], total: 0 })
        : getBackend().listQrCodes({ filter, serial, from, to, page }),
    [filter, q, from, to, page],
  );

  const href = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams();
    const merged = { filter, q, from, to, page, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v && !(k === "filter" && v === "all") && !(k === "page" && v === 1)) params.set(k, String(v));
    }
    const s = params.toString();
    return s ? `/admin/qr/?${s}` : "/admin/qr/";
  };

  function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    router.push(href({ q: String(f.get("q") ?? ""), from: String(f.get("from") ?? ""), to: String(f.get("to") ?? ""), page: 1 }));
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader title="QRコード一覧">
        <Link href="/admin/qr/new/" className={buttonPrimary}>
          QRコードを新規発行
        </Link>
      </PageHeader>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <div className="mb-4 flex flex-wrap gap-2">
        {QR_FILTERS.map((f) => (
          <Link
            key={f}
            href={href({ filter: f, page: 1 })}
            className={`rounded-full border px-3 py-1 text-sm ${f === filter ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}
          >
            {FILTER_LABEL[f]}
          </Link>
        ))}
      </div>

      <form key={`${q}|${from}|${to}`} onSubmit={search} className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm">
          <span className="block text-slate-600">識別番号</span>
          <input name="q" defaultValue={q} placeholder="QR-000001" className="mt-1 rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm">
          <span className="block text-slate-600">発行日（から）</span>
          <input type="date" name="from" defaultValue={from} className="mt-1 rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm">
          <span className="block text-slate-600">発行日（まで）</span>
          <input type="date" name="to" defaultValue={to} className="mt-1 rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <button type="submit" className={buttonSecondary}>
          検索
        </button>
        {(q || from || to) && (
          <Link href={href({ q: "", from: "", to: "", page: 1 })} className="text-sm text-sky-700 hover:underline">
            条件をクリア
          </Link>
        )}
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
                  <th className={thClass}>発行日時</th>
                  <th className={thClass}>QRコードの状態</th>
                  <th className={thClass}>住所登録日時</th>
                  <th className={thClass}>発送状態</th>
                  <th className={thClass}>発送日時</th>
                  <th className={thClass}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className={`${tdClass} font-mono`}>{formatSerial(r.serial_no)}</td>
                    <td className={tdClass}>{formatDateTime(r.created_at)}</td>
                    <td className={tdClass}>
                      <QrStatusBadge status={r.status} />
                      {r.status === "revoked" && <div className="mt-1 text-xs text-slate-500">{formatDateTime(r.revoked_at)}</div>}
                    </td>
                    <td className={tdClass}>{formatDateTime(r.address_registered_at)}</td>
                    <td className={tdClass}>
                      <ShipmentStatusBadge status={r.shipment_status} />
                    </td>
                    <td className={tdClass}>{formatDateTime(r.shipped_at)}</td>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {r.status === "unused" && (
                        <Link href={`/admin/qr/revoke/?id=${r.id}`} className="text-red-700 hover:underline">
                          無効化
                        </Link>
                      )}
                      {r.status === "used" && (
                        <Link href={`/admin/addresses/detail/?id=${r.id}`} className="text-sky-700 hover:underline">
                          住所を見る
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className={tdClass} colSpan={7}>
                      該当するQRコードはありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} href={(p) => href({ page: p })} />
        </>
      )}
    </>
  );
}
