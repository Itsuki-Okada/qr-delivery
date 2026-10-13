export function formatSerial(serial: number | string | bigint): string {
  return `QR-${String(serial).padStart(6, "0")}`;
}

/** 「QR-000012」「000012」「12」などから識別番号を取り出す */
export function parseSerial(input: string): number | null {
  const m = input.normalize("NFKC").trim().match(/^(?:QR-?)?0*(\d{1,12})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFormatter.format(d);
}

export const QR_STATUS_LABEL: Record<string, string> = {
  unused: "未使用",
  used: "住所登録済み",
  revoked: "無効化済み",
};

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending: "発送待ち",
  shipped: "発送済み",
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "qr.issue": "QRコード発行",
  "qr.revoke": "QRコード無効化",
  "address.register": "住所登録（顧客）",
  "address.update": "住所修正",
  "shipment.mark_shipped": "発送済みに変更",
};

export const ADDRESS_FIELD_LABEL: Record<string, string> = {
  recipient_name: "氏名",
  postal_code: "郵便番号",
  prefecture: "都道府県",
  city: "市区町村",
  address_line: "番地",
  building: "建物名・部屋番号",
  phone: "電話番号",
};
