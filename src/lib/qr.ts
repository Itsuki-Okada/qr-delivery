import QRCode from "qrcode";

// 誤り訂正 M（約15%）、クワイエットゾーン 4 モジュール（規格の推奨値）
const BASE_OPTIONS = { errorCorrectionLevel: "M", margin: 4 } as const;

export async function qrSvgDataUrl(text: string): Promise<string> {
  const svg = await QRCode.toString(text, { ...BASE_OPTIONS, type: "svg" });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 印刷用の高解像度 PNG（ブラウザ・Node.js 共通） */
export async function qrPngBytes(text: string, width = 1200): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(text, { ...BASE_OPTIONS, type: "image/png", width });
  const bin = atob(dataUrl.split(",")[1]);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
