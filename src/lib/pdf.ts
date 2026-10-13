import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { qrPngBytes } from "@/lib/qr";

const MM = 72 / 25.4;
/** 印刷時の QR コードの一辺（クワイエットゾーン込み）。スマートフォンで読み取りやすい 50mm 程度。 */
export const QR_PRINT_SIZE_MM = 50;

/**
 * 1 件分の印刷用 PDF（A4 縦）。QR コードと識別番号のみを載せ、顧客情報・トークン文字列は載せない。
 * 標準フォントは日本語を含まないため、PDF 内の文字は英数字のみとする（日本語の案内文は HTML 印刷を利用）。
 */
export async function createQrPdf(params: { redeemUrl: string; serialLabel: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(params.serialLabel);
  doc.setSubject("QR code");
  doc.setCreator("qr-delivery");
  doc.setProducer("qr-delivery");

  const page = doc.addPage([210 * MM, 297 * MM]);
  const { width, height } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const png = await doc.embedPng(await qrPngBytes(params.redeemUrl));
  const size = QR_PRINT_SIZE_MM * MM;
  const qrX = (width - size) / 2;
  const qrY = height - 40 * MM - size;

  // 切り取り用の枠（QR の周囲に十分な余白）
  const pad = 12 * MM;
  page.drawRectangle({
    x: qrX - pad,
    y: qrY - pad - 14 * MM,
    width: size + pad * 2,
    height: size + pad * 2 + 14 * MM,
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 0.5,
    borderDashArray: [4, 3],
  });

  page.drawImage(png, { x: qrX, y: qrY, width: size, height: size });

  const label = params.serialLabel;
  const labelSize = 14;
  page.drawText(label, {
    x: (width - bold.widthOfTextAtSize(label, labelSize)) / 2,
    y: qrY - 9 * MM,
    size: labelSize,
    font: bold,
  });

  const note = "Scan with your smartphone camera";
  page.drawText(note, {
    x: (width - font.widthOfTextAtSize(note, 9)) / 2,
    y: qrY - 14 * MM,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  return doc.save();
}
