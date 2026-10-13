"use client";

import { PREFECTURES } from "@/lib/prefectures";
import type { AddressField, FieldErrors } from "@/lib/validation/address";

export type AddressValues = Record<AddressField, string>;

export const EMPTY_ADDRESS: AddressValues = {
  recipient_name: "",
  postal_code: "",
  prefecture: "",
  city: "",
  address_line: "",
  building: "",
  phone: "",
};

const FIELDS: {
  name: AddressField;
  label: string;
  required: boolean;
  autoComplete: string;
  inputMode?: "numeric" | "tel" | "text";
  placeholder?: string;
  hint?: string;
}[] = [
  { name: "recipient_name", label: "氏名", required: true, autoComplete: "name", placeholder: "山田 太郎" },
  { name: "postal_code", label: "郵便番号", required: true, autoComplete: "postal-code", inputMode: "numeric", placeholder: "100-0001", hint: "ハイフンなしでも入力できます" },
  { name: "prefecture", label: "都道府県", required: true, autoComplete: "address-level1" },
  { name: "city", label: "市区町村", required: true, autoComplete: "address-level2", placeholder: "千代田区" },
  { name: "address_line", label: "番地", required: true, autoComplete: "address-line1", placeholder: "千代田1-1" },
  { name: "building", label: "建物名・部屋番号", required: false, autoComplete: "address-line2", placeholder: "〇〇マンション 101号室" },
  { name: "phone", label: "電話番号", required: true, autoComplete: "tel", inputMode: "tel", placeholder: "090-1234-5678", hint: "配送時の連絡に使用します" },
];

export function AddressFields({
  values,
  errors,
  onChange,
  disabled,
  idPrefix = "addr",
}: {
  values: AddressValues;
  errors: FieldErrors;
  onChange: (name: AddressField, value: string) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  return (
    <div className="space-y-5">
      {FIELDS.map((f) => {
        const id = `${idPrefix}-${f.name}`;
        const error = errors[f.name];
        const describedBy = [error ? `${id}-error` : null, f.hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
        const base = `mt-1.5 block w-full rounded-lg border px-3 py-3 text-base ${error ? "border-red-500 bg-red-50" : "border-slate-300 bg-white"}`;
        return (
          <div key={f.name}>
            <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold">
              {f.label}
              {f.required ? (
                <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">必須</span>
              ) : (
                <span className="rounded bg-slate-400 px-1.5 py-0.5 text-[10px] font-bold text-white">任意</span>
              )}
            </label>
            {f.name === "prefecture" ? (
              <select
                id={id}
                name={f.name}
                value={values.prefecture}
                onChange={(e) => onChange(f.name, e.target.value)}
                autoComplete={f.autoComplete}
                aria-invalid={!!error}
                aria-describedby={describedBy}
                disabled={disabled}
                className={base}
              >
                <option value="">選択してください</option>
                {PREFECTURES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={f.name}
                type={f.name === "phone" ? "tel" : "text"}
                value={values[f.name]}
                onChange={(e) => onChange(f.name, e.target.value)}
                autoComplete={f.autoComplete}
                inputMode={f.inputMode}
                placeholder={f.placeholder}
                aria-invalid={!!error}
                aria-describedby={describedBy}
                disabled={disabled}
                className={base}
              />
            )}
            {f.hint && !error && (
              <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
                {f.hint}
              </p>
            )}
            {error && (
              <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-700">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
