"use client";

import { useState } from "react";
import { AddressFields, type AddressValues } from "@/components/AddressFields";
import { Notice, buttonPrimary } from "@/components/ui";
import { getBackend } from "@/lib/backend";
import { validateAddress, type FieldErrors } from "@/lib/validation/address";

export function AddressEditForm({
  qrCodeId,
  initial,
  onSaved,
}: {
  qrCodeId: string;
  initial: AddressValues;
  onSaved: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateAddress(values);
    if (!v.success) {
      setErrors(v.fieldErrors);
      setMessage({ kind: "error", text: "入力内容を確認してください。" });
      return;
    }
    if (!confirm("住所を修正します。よろしいですか？")) return;
    setErrors({});
    setMessage(null);
    setPending(true);
    try {
      const r = await getBackend().updateAddress(qrCodeId, v.data);
      if (r === "ok") {
        setMessage({ kind: "success", text: "住所を修正しました。" });
        onSaved();
      } else if (r === "no_change") {
        setMessage({ kind: "success", text: "変更はありませんでした。" });
      } else {
        setMessage({ kind: "error", text: "住所が見つかりません。" });
      }
    } catch {
      setMessage({ kind: "error", text: "住所の修正に失敗しました。" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <AddressFields
        idPrefix="edit"
        values={values}
        errors={errors}
        disabled={pending}
        onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      />
      <button type="submit" disabled={pending} className={`${buttonPrimary} mt-6`}>
        {pending ? "保存中…" : "修正を保存"}
      </button>
    </form>
  );
}
