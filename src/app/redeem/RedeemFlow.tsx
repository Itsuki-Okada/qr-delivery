"use client";

import { useEffect, useRef, useState } from "react";
import { AddressFields, EMPTY_ADDRESS, type AddressValues } from "@/components/AddressFields";
import { getBackend } from "@/lib/backend";
import { ADDRESS_FIELDS, validateAddress, type Address, type FieldErrors } from "@/lib/validation/address";
import { RedeemMessage, type RedeemMessageKind } from "./RedeemMessage";

type Step =
  | { name: "input" }
  | { name: "confirm"; data: Address }
  | { name: "message"; kind: RedeemMessageKind; retry?: Address };

const CONFIRM_ROWS: { key: keyof Address; label: string }[] = [
  { key: "recipient_name", label: "氏名" },
  { key: "postal_code", label: "郵便番号" },
  { key: "prefecture", label: "都道府県" },
  { key: "city", label: "市区町村" },
  { key: "address_line", label: "番地" },
  { key: "building", label: "建物名・部屋番号" },
  { key: "phone", label: "電話番号" },
];

export function RedeemFlow({ token }: { token: string }) {
  const [step, setStep] = useState<Step>({ name: "input" });
  const [values, setValues] = useState<AddressValues>(EMPTY_ADDRESS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  // 連打による二重送信をクライアント側でも抑止する（最終的な防止は DB 側のロックと状態確認）
  const inFlight = useRef(false);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step.name]);

  function showErrors(fieldErrors: FieldErrors) {
    setErrors(fieldErrors);
    const first = ADDRESS_FIELDS.find((f) => fieldErrors[f]);
    if (first) requestAnimationFrame(() => document.getElementById(`addr-${first}`)?.focus());
  }

  function toConfirm(e: React.FormEvent) {
    e.preventDefault();
    const result = validateAddress(values);
    if (!result.success) {
      showErrors(result.fieldErrors);
      return;
    }
    setErrors({});
    setStep({ name: "confirm", data: result.data });
  }

  async function register(data: Address) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const res = await getBackend().redeemSubmit(token, data);
      if (res.status === "ok") {
        setStep({ name: "message", kind: "done" });
      } else if (res.status === "validation") {
        // サーバー側（DB）の検証で弾かれた項目
        setStep({ name: "input" });
        showErrors(Object.fromEntries(res.fields.map((f) => [f, "入力内容を確認してください"])));
      } else {
        setStep({ name: "message", kind: res.status });
      }
    } catch {
      setStep({ name: "message", kind: "network", retry: data });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (step.name === "message") {
    return (
      <RedeemMessage kind={step.kind}>
        {step.retry && (
          <button
            type="button"
            className="mt-6 w-full rounded-xl bg-slate-900 py-4 text-base font-bold text-white"
            onClick={() => setStep({ name: "confirm", data: step.retry! })}
          >
            確認画面に戻る
          </button>
        )}
      </RedeemMessage>
    );
  }

  return (
    <div>
      <ol className="mb-5 flex items-center justify-center gap-2 text-xs font-semibold" aria-label="手順">
        {["入力", "確認", "完了"].map((label, i) => {
          const active = (step.name === "input" && i === 0) || (step.name === "confirm" && i === 1);
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={active ? "step" : undefined}
                className={`rounded-full px-3 py-1 ${active ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500"}`}
              >
                {i + 1}. {label}
              </span>
              {i < 2 && <span className="text-slate-300">›</span>}
            </li>
          );
        })}
      </ol>

      {step.name === "input" ? (
        <form onSubmit={toConfirm} noValidate className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-lg font-bold">お届け先のご登録</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            商品のお届け先を入力してください。<strong>ご登録は1回限り</strong>で、登録後はこの画面から変更できません。
          </p>
          {Object.keys(errors).length > 0 && (
            <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
              入力内容に誤りがあります。赤枠の項目をご確認ください。
            </p>
          )}
          <div className="mt-5">
            <AddressFields
              values={values}
              errors={errors}
              onChange={(name, value) => {
                setValues((v) => ({ ...v, [name]: value }));
                if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
              }}
            />
          </div>
          <button type="submit" className="mt-8 w-full rounded-xl bg-slate-900 py-4 text-base font-bold text-white">
            入力内容を確認する
          </button>
        </form>
      ) : (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-lg font-bold">入力内容のご確認</h1>
          <p className="mt-2 text-sm text-slate-600">
            以下の内容で登録します。<strong>登録後は変更できません。</strong>内容をよくご確認ください。
          </p>
          <dl className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {CONFIRM_ROWS.map((row) => (
              <div key={row.key} className="px-4 py-3">
                <dt className="text-xs text-slate-500">{row.label}</dt>
                <dd className="mt-0.5 break-words text-base">{step.data[row.key] || "（なし）"}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 space-y-3">
            <button
              type="button"
              onClick={() => register(step.data)}
              disabled={submitting}
              className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white disabled:opacity-60"
            >
              {submitting ? "登録しています…" : "この内容で登録する"}
            </button>
            <button
              type="button"
              onClick={() => setStep({ name: "input" })}
              disabled={submitting}
              className="w-full rounded-xl border border-slate-300 bg-white py-4 text-base font-bold text-slate-800 disabled:opacity-60"
            >
              入力内容を修正する
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
