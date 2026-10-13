"use client";

import Link from "next/link";
import { useState } from "react";
import { getBackend } from "@/lib/backend";
import { formatDateTime, formatSerial } from "@/lib/format";
import { useAsync } from "@/components/useAsync";
import { PageHeader, QrStatusBadge, tableClass, tdClass, thClass } from "@/components/ui";
import { IssuePanel } from "./IssuePanel";

export default function IssuePage() {
  const [version, setVersion] = useState(0);
  const { data } = useAsync(() => getBackend().listQrCodes({ page: 1 }), [version]);
  const recent = data?.rows.slice(0, 10) ?? [];
  return (
    <>
      <div className="no-print">
        <PageHeader title="QRコード発行" />
        <p className="mb-6 text-sm text-slate-600">
          1回の操作で1件だけ発行します。QRコードはこの画面でのみ表示・印刷できます（再表示はできません）。
          印刷できなかった場合は、そのQRコードを無効化して新たに発行してください。
        </p>
      </div>
      <IssuePanel onIssued={() => setVersion((v) => v + 1)} />
      <section className="no-print mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">発行履歴（最新10件）</h2>
          <Link href="/admin/qr/" className="text-sm text-sky-700 hover:underline">
            すべて表示
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass}>識別番号</th>
                <th className={thClass}>発行日時</th>
                <th className={thClass}>状態</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className={`${tdClass} font-mono`}>{formatSerial(r.serial_no)}</td>
                  <td className={tdClass}>{formatDateTime(r.created_at)}</td>
                  <td className={tdClass}>
                    <QrStatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
              {data && recent.length === 0 && (
                <tr>
                  <td className={tdClass} colSpan={3}>
                    まだ発行されていません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
