"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { getBackend } from "@/lib/backend";
import { formatDateTime, formatSerial } from "@/lib/format";
import { useAsync } from "@/components/useAsync";
import { LoadError, Loading, Notice, PageHeader, QrStatusBadge, buttonDanger, buttonSecondary } from "@/components/ui";

export default function RevokePage() {
  return (
    <Suspense fallback={<Loading />}>
      <RevokeConfirm />
    </Suspense>
  );
}

function RevokeConfirm() {
  const router = useRouter();
  const id = useSearchParams().get("id") ?? "";
  const { data: qr, error, loading } = useAsync(() => getBackend().getQrOverview(id), [id]);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function revoke() {
    setPending(true);
    setFailed(false);
    try {
      const r = await getBackend().revokeQrCode(id);
      router.push(`/admin/qr/?notice=${r === "ok" ? "revoked" : "revoke_not_unused"}`);
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader title="QRコードの無効化" />
      {loading && <Loading />}
      {error ? <LoadError /> : null}
      {!loading && !error && !qr && <Notice kind="error">対象のQRコードが見つかりません。</Notice>}
      {qr && (
        <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-6">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">識別番号</dt>
            <dd className="font-mono">{formatSerial(qr.serial_no)}</dd>
            <dt className="text-slate-500">発行日時</dt>
            <dd>{formatDateTime(qr.created_at)}</dd>
            <dt className="text-slate-500">状態</dt>
            <dd>
              <QrStatusBadge status={qr.status} />
            </dd>
          </dl>
          {qr.status === "unused" ? (
            <>
              <div className="mt-6">
                <Notice kind="error">
                  無効化すると、このQRコードからは住所を登録できなくなります。この操作は取り消せません。
                </Notice>
              </div>
              {failed && <Notice kind="error">無効化に失敗しました。再度お試しください。</Notice>}
              <div className="flex gap-3">
                <button type="button" onClick={revoke} disabled={pending} className={buttonDanger}>
                  {pending ? "処理中…" : "無効化する"}
                </button>
                <Link href="/admin/qr/" className={buttonSecondary}>
                  キャンセル
                </Link>
              </div>
            </>
          ) : (
            <div className="mt-6">
              <Notice kind="info">未使用のQRコードのみ無効化できます。</Notice>
              <Link href="/admin/qr/" className={buttonSecondary}>
                一覧に戻る
              </Link>
            </div>
          )}
        </div>
      )}
    </>
  );
}
