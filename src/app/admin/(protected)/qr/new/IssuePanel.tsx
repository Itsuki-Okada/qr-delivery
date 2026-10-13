"use client";

import Link from "next/link";
import { useState } from "react";
import { getBackend } from "@/lib/backend";
import { DEMO_MODE, siteBaseUrl } from "@/lib/config";
import { formatSerial } from "@/lib/format";
import { createQrPdf } from "@/lib/pdf";
import { qrSvgDataUrl } from "@/lib/qr";
import { buildRedeemUrl } from "@/lib/token";
import { Notice, buttonPrimary, buttonSecondary } from "@/components/ui";

interface Issued {
  serialLabel: string;
  redeemUrl: string;
  imageDataUrl: string;
  token: string;
}

export function IssuePanel({ onIssued }: { onIssued?: () => void }) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pdfError, setPdfError] = useState(false);

  async function issue() {
    if (pending) return;
    if (issued && !confirm("表示中のQRコードは再表示できなくなります。印刷は完了しましたか？")) return;
    setError(null);
    setPending(true);
    try {
      // トークンは DB（デモではブラウザ）で生成され、この画面にだけ 1 度返される
      const qr = await getBackend().issueQrCode();
      const redeemUrl = buildRedeemUrl(siteBaseUrl(), qr.token);
      setIssued({
        serialLabel: formatSerial(qr.serial_no),
        redeemUrl,
        imageDataUrl: await qrSvgDataUrl(redeemUrl),
        token: qr.token,
      });
      setPdfError(false);
      onIssued?.();
    } catch {
      setError("QRコードの発行に失敗しました。発行されたかどうかを一覧でご確認ください。");
    } finally {
      setPending(false);
    }
  }

  async function downloadPdf() {
    if (!issued) return;
    try {
      const bytes = await createQrPdf({ redeemUrl: issued.redeemUrl, serialLabel: issued.serialLabel });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${issued.serialLabel}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPdfError(false);
    } catch {
      setPdfError(true);
    }
  }

  return (
    <section>
      <div className="no-print">
        {error && <Notice kind="error">{error}</Notice>}
        <button type="button" onClick={issue} disabled={pending} className={`${buttonPrimary} px-6 py-3 text-base`}>
          {pending ? "発行中…" : "QRコードを新規発行"}
        </button>
      </div>

      {issued && (
        <div className="mt-8">
          <div className="no-print">
            <Notice kind="success">{issued.serialLabel} を発行しました。印刷またはPDFを保存してください。</Notice>
          </div>
          {/* 印刷対象。QRコードと識別番号のみで、URL文字列や個人情報は含めない */}
          <div className="mx-auto flex w-fit flex-col items-center rounded-xl border border-dashed border-slate-400 bg-white p-10 print:border-slate-300">
            <p className="text-base font-bold">配送先ご登録のお願い</p>
            <p className="mt-1 text-center text-xs text-slate-600">
              スマートフォンのカメラで読み取り、
              <br />
              お届け先をご登録ください。
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- ブラウザで生成した SVG の data URL */}
            <img
              src={issued.imageDataUrl}
              alt={`QRコード ${issued.serialLabel}`}
              className="mt-4 h-[50mm] w-[50mm]"
              width={189}
              height={189}
            />
            <p className="mt-2 font-mono text-lg font-bold tracking-wider">{issued.serialLabel}</p>
            <p className="mt-1 text-[10px] text-slate-500">ご登録は1回限りです。</p>
          </div>
          <div className="no-print mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" className={buttonPrimary} onClick={() => window.print()}>
              印刷する
            </button>
            <button type="button" className={buttonSecondary} onClick={downloadPdf}>
              印刷用PDFをダウンロード
            </button>
            {DEMO_MODE && (
              <Link href={`/redeem/#${issued.token}`} target="_blank" className={buttonSecondary}>
                顧客画面を開く（デモ）
              </Link>
            )}
          </div>
          {pdfError && (
            <div className="no-print mt-3">
              <Notice kind="error">PDFを作成できませんでした。再度お試しください。</Notice>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
