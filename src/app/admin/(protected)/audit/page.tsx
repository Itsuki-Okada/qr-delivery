"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getBackend, PAGE_SIZE, type AuditAction } from "@/lib/backend";
import { ADDRESS_FIELD_LABEL, AUDIT_ACTION_LABEL, formatDateTime, formatSerial } from "@/lib/format";
import { useAsync } from "@/components/useAsync";
import { LoadError, Loading, PageHeader, Pagination, tableClass, tdClass, thClass } from "@/components/ui";

export default function AuditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Audit />
    </Suspense>
  );
}

function Audit() {
  const sp = useSearchParams();
  const actionParam = sp.get("action") ?? "";
  const action = actionParam in AUDIT_ACTION_LABEL ? (actionParam as AuditAction) : undefined;
  const page = Number(sp.get("page") ?? "1") || 1;
  const { data, error, loading, reload } = useAsync(async () => {
    const [list, names] = await Promise.all([getBackend().listAuditLogs({ page, action }), getBackend().getAdminNames()]);
    return { ...list, names };
  }, [page, action]);

  return (
    <>
      <PageHeader title="操作履歴" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/admin/audit/"
          className={`rounded-full border px-3 py-1 text-sm ${!action ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}
        >
          すべて
        </Link>
        {Object.entries(AUDIT_ACTION_LABEL).map(([key, label]) => (
          <Link
            key={key}
            href={`/admin/audit/?action=${encodeURIComponent(key)}`}
            className={`rounded-full border px-3 py-1 text-sm ${action === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      {error ? <LoadError onRetry={reload} /> : null}
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>日時</th>
                  <th className={thClass}>操作</th>
                  <th className={thClass}>操作者</th>
                  <th className={thClass}>識別番号</th>
                  <th className={thClass}>詳細</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((r) => {
                  const serial = r.metadata.serial_no;
                  const changed = r.metadata.changed_fields;
                  return (
                    <tr key={r.id}>
                      <td className={`${tdClass} whitespace-nowrap`}>{formatDateTime(r.created_at)}</td>
                      <td className={tdClass}>{AUDIT_ACTION_LABEL[r.action] ?? r.action}</td>
                      <td className={tdClass}>
                        {r.actor_type === "customer" ? "顧客" : (data?.names.get(r.actor_id ?? "") ?? "（不明な管理者）")}
                      </td>
                      <td className={`${tdClass} font-mono`}>
                        {typeof serial === "number" || typeof serial === "string" ? formatSerial(serial) : "—"}
                      </td>
                      <td className={tdClass}>
                        {Array.isArray(changed)
                          ? `変更: ${(changed as string[]).map((f) => ADDRESS_FIELD_LABEL[f] ?? f).join("、")}`
                          : ""}
                      </td>
                    </tr>
                  );
                })}
                {data?.rows.length === 0 && (
                  <tr>
                    <td className={tdClass} colSpan={5}>
                      履歴はありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            total={data?.total ?? 0}
            pageSize={PAGE_SIZE}
            href={(p) => `/admin/audit/?${new URLSearchParams({ ...(action ? { action } : {}), page: String(p) })}`}
          />
        </>
      )}
    </>
  );
}
