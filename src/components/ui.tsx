import Link from "next/link";
import type { ReactNode } from "react";
import { QR_STATUS_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/format";

const QR_STATUS_STYLE: Record<string, string> = {
  unused: "bg-amber-100 text-amber-800",
  used: "bg-emerald-100 text-emerald-800",
  revoked: "bg-slate-200 text-slate-600",
};
const SHIPMENT_STATUS_STYLE: Record<string, string> = {
  pending: "bg-sky-100 text-sky-800",
  shipped: "bg-indigo-100 text-indigo-800",
};

export function QrStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${QR_STATUS_STYLE[status] ?? ""}`}>
      {QR_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function ShipmentStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${SHIPMENT_STATUS_STYLE[status] ?? ""}`}>
      {SHIPMENT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "success" | "error" | "info"; children: ReactNode }) {
  const style =
    kind === "success"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : kind === "error"
        ? "border-red-300 bg-red-50 text-red-900"
        : "border-sky-300 bg-sky-50 text-sky-900";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`mb-4 rounded-lg border px-4 py-3 text-sm ${style}`}>
      {children}
    </div>
  );
}

export function Pagination({
  page,
  total,
  pageSize,
  href,
}: {
  page: number;
  total: number;
  pageSize: number;
  href: (page: number) => string;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-center gap-4 text-sm" aria-label="ページ送り">
      {page > 1 ? <Link className="text-sky-700 hover:underline" href={href(page - 1)}>← 前へ</Link> : <span className="text-slate-300">← 前へ</span>}
      <span>
        {page} / {last}
      </span>
      {page < last ? <Link className="text-sky-700 hover:underline" href={href(page + 1)}>次へ →</Link> : <span className="text-slate-300">次へ →</span>}
    </nav>
  );
}

export const tableClass = "w-full border-collapse text-sm";
export const thClass = "border-b border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap";
export const tdClass = "border-b border-slate-100 px-3 py-2 align-top";
export const buttonPrimary =
  "inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonDanger =
  "inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50";

export function Loading({ label = "読み込み中…" }: { label?: string }) {
  return (
    <p className="py-10 text-center text-sm text-slate-500" role="status">
      {label}
    </p>
  );
}

export function LoadError({ onRetry }: { onRetry?: () => void }) {
  return (
    <Notice kind="error">
      データを読み込めませんでした。通信状況をご確認ください。
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-3 underline">
          再読み込み
        </button>
      )}
    </Notice>
  );
}
