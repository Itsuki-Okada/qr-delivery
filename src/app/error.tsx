"use client";

// エラー詳細（スタックトレース・内部情報）は表示しない
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center p-6 text-center">
      <h1 className="text-xl font-bold">エラーが発生しました</h1>
      <p className="mt-3 text-sm text-slate-600">
        申し訳ありません。時間をおいてから再度お試しください。
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
      >
        再読み込み
      </button>
    </main>
  );
}
