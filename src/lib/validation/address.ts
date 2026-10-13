import { z } from "zod";
import { PREFECTURES } from "@/lib/prefectures";

// 制御文字・書式文字（ゼロ幅文字や双方向制御文字など）は受け付けない
const FORBIDDEN_CHARS = /[\p{Cc}\p{Cf}]/u;
const normalize = (s: string) => s.normalize("NFKC").trim();

function requiredText(label: string, max: number) {
  return z
    .string({ error: `${label}を入力してください` })
    .transform(normalize)
    .pipe(
      z
        .string()
        .min(1, `${label}を入力してください`)
        .max(max, `${label}は${max}文字以内で入力してください`)
        .refine((s) => !FORBIDDEN_CHARS.test(s), `${label}に使用できない文字が含まれています`),
    );
}

export const addressSchema = z.object({
  recipient_name: requiredText("氏名", 100),
  postal_code: z
    .string({ error: "郵便番号を入力してください" })
    .transform((s) => normalize(s).replace(/[-‐－ー―\s]/g, ""))
    .pipe(
      z
        .string()
        .min(1, "郵便番号を入力してください")
        .regex(/^\d{7}$/, "郵便番号は7桁の数字で入力してください（例: 100-0001）"),
    )
    .transform((s) => `${s.slice(0, 3)}-${s.slice(3)}`),
  prefecture: z.enum(PREFECTURES, { error: "都道府県を選択してください" }),
  city: requiredText("市区町村", 100),
  address_line: requiredText("番地", 200),
  building: z
    .string()
    .optional()
    .transform((s) => normalize(s ?? ""))
    .pipe(
      z
        .string()
        .max(200, "建物名・部屋番号は200文字以内で入力してください")
        .refine((s) => !FORBIDDEN_CHARS.test(s), "建物名・部屋番号に使用できない文字が含まれています"),
    ),
  phone: z
    .string({ error: "電話番号を入力してください" })
    .transform((s) => normalize(s).replace(/[-‐－ー―()（）\s]/g, ""))
    .pipe(
      z
        .string()
        .min(1, "電話番号を入力してください")
        .regex(/^0\d{9,10}$/, "電話番号は0から始まる10〜11桁の数字で入力してください"),
    ),
});

export type AddressInput = z.input<typeof addressSchema>;
export type Address = z.output<typeof addressSchema>;
export type AddressField = keyof Address;
export type FieldErrors = Partial<Record<AddressField, string>>;

export const ADDRESS_FIELDS: readonly AddressField[] = [
  "recipient_name",
  "postal_code",
  "prefecture",
  "city",
  "address_line",
  "building",
  "phone",
];

export function validateAddress(raw: unknown):
  | { success: true; data: Address }
  | { success: false; fieldErrors: FieldErrors } {
  const parsed = addressSchema.safeParse(raw);
  if (parsed.success) return { success: true, data: parsed.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && (ADDRESS_FIELDS as readonly string[]).includes(key)) {
      fieldErrors[key as AddressField] ??= issue.message;
    }
  }
  if (Object.keys(fieldErrors).length === 0) fieldErrors.recipient_name = "入力内容を確認してください";
  return { success: false, fieldErrors };
}

/** DB 関数（redeem_qr_code / admin_update_address）へ渡す引数 */
export function toRpcArgs(a: Address) {
  return {
    p_recipient_name: a.recipient_name,
    p_postal_code: a.postal_code,
    p_prefecture: a.prefecture,
    p_city: a.city,
    p_address_line: a.address_line,
    p_building: a.building,
    p_phone: a.phone,
  };
}
