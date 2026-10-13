// 顧客向けのエラー・完了メッセージ。個人情報や内部情報（エラー詳細・ID等）は表示しない。
export type RedeemMessageKind = "done" | "invalid" | "used" | "revoked" | "rate_limited" | "network" | "server_error";

const MESSAGES: Record<RedeemMessageKind, { title: string; body: string; tone: "ok" | "ng" }> = {
  done: {
    title: "ご登録ありがとうございました",
    body: "お届け先の登録が完了しました。商品の発送まで今しばらくお待ちください。このQRコードは使用済みとなり、再度の登録はできません。",
    tone: "ok",
  },
  invalid: {
    title: "QRコードを確認できません",
    body: "このQRコードは無効です。お手元のQRコードをもう一度読み取ってください。解決しない場合はお問い合わせください。",
    tone: "ng",
  },
  used: {
    title: "このQRコードは登録済みです",
    body: "このQRコードからは既にお届け先が登録されています。登録内容の変更をご希望の場合はお問い合わせください。",
    tone: "ng",
  },
  revoked: {
    title: "このQRコードは現在ご利用いただけません",
    body: "このQRコードは無効化されています。詳しくはお問い合わせください。",
    tone: "ng",
  },
  rate_limited: {
    title: "アクセスが集中しています",
    body: "しばらく時間をおいてから、もう一度お試しください。",
    tone: "ng",
  },
  network: {
    title: "通信エラーが発生しました",
    body: "通信状況をご確認のうえ、もう一度お試しください。登録が完了したかどうか分からない場合は、QRコードを再度読み取ってご確認ください。",
    tone: "ng",
  },
  server_error: {
    title: "エラーが発生しました",
    body: "申し訳ありません。時間をおいてから、もう一度お試しください。",
    tone: "ng",
  },
};

export function RedeemMessage({ kind, children }: { kind: RedeemMessageKind; children?: React.ReactNode }) {
  const m = MESSAGES[kind];
  return (
    <div className="rounded-2xl bg-white p-6 text-center shadow-sm" role={m.tone === "ng" ? "alert" : "status"}>
      <div
        aria-hidden
        className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold ${m.tone === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
      >
        {m.tone === "ok" ? "✓" : "!"}
      </div>
      <h1 className="text-lg font-bold">{m.title}</h1>
      <p className="mt-3 text-left text-sm leading-relaxed text-slate-700">{m.body}</p>
      {children}
    </div>
  );
}
