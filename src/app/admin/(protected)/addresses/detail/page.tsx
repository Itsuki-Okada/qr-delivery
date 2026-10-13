"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getBackend } from "@/lib/backend";
import { ADDRESS_FIELD_LABEL, AUDIT_ACTION_LABEL, formatDateTime, formatSerial } from "@/lib/format";
import { useAsync } from "@/components/useAsync";
import {
  LoadError,
  Loading,
  Notice,
  PageHeader,
  QrStatusBadge,
  ShipmentStatusBadge,
  tableClass,
  tdClass,
  thClass,
} from "@/components/ui";
import { AddressEditForm } from "./AddressEditForm";

export default function AddressDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AddressDetail />
    </Suspense>
  );
}

function AddressDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error, loading, reload } = useAsync(async () => {
    const [detail, names] = await Promise.all([getBackend().getAddressDetail(id), getBackend().getAdminNames()]);
    return { detail, names };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error) return <LoadError onRetry={reload} />;
  if (!data?.detail?.address) return <Notice kind="error">住所が見つかりません。</Notice>;
  const { qr, address, history } = data.detail;
  const name = (uid: string | null) => (uid ? (data.names.get(uid) ?? "（不明な管理者）") : "顧客");

  return (
    <>
      <PageHeader title={`住所の詳細 ${formatSerial(qr.serial_no)}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 font-bold">状態</h2>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">QRコード</dt>
            <dd>
              <QrStatusBadge status={qr.status} />
            </dd>
            <dt className="text-slate-500">発行日時</dt>
            <dd>{formatDateTime(qr.created_at)}</dd>
            <dt className="text-slate-500">住所登録日時</dt>
            <dd>{formatDateTime(address.created_at)}</dd>
            <dt className="text-slate-500">最終修正</dt>
            <dd>{address.updated_by ? `${formatDateTime(address.updated_at)}（${name(address.updated_by)}）` : "—"}</dd>
            <dt className="text-slate-500">発送状態</dt>
            <dd>
              <ShipmentStatusBadge status={qr.shipment_status} />
            </dd>
            <dt className="text-slate-500">発送日時</dt>
            <dd>{qr.shipped_at ? `${formatDateTime(qr.shipped_at)}（${name(qr.shipped_by)}）` : "—"}</dd>
          </dl>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 font-bold">住所の修正</h2>
          <AddressEditForm
            qrCodeId={qr.id}
            onSaved={reload}
            initial={{
              recipient_name: address.recipient_name,
              postal_code: address.postal_code,
              prefecture: address.prefecture,
              city: address.city,
              address_line: address.address_line,
              building: address.building ?? "",
              phone: address.phone,
            }}
          />
        </section>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold">操作履歴</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass}>日時</th>
                <th className={thClass}>操作</th>
                <th className={thClass}>操作者</th>
                <th className={thClass}>変更項目</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className={tdClass}>{formatDateTime(h.created_at)}</td>
                  <td className={tdClass}>{AUDIT_ACTION_LABEL[h.action] ?? h.action}</td>
                  <td className={tdClass}>{name(h.actor_id)}</td>
                  <td className={tdClass}>
                    {Array.isArray(h.metadata.changed_fields)
                      ? (h.metadata.changed_fields as string[]).map((f) => ADDRESS_FIELD_LABEL[f] ?? f).join("、")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
