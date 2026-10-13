import jsQR from "jsqr";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { createQrPdf } from "@/lib/pdf";
import { qrPngBytes, qrSvgDataUrl } from "@/lib/qr";
import { buildRedeemUrl, generateToken } from "@/lib/token";

function decode(png: Uint8Array) {
  const img = PNG.sync.read(Buffer.from(png));
  return jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data;
}

describe("QR コード画像", () => {
  const url = buildRedeemUrl("https://example.com", generateToken());

  it("PNG を読み取ると QR 固有の URL になる", async () => {
    expect(decode(await qrPngBytes(url))).toBe(url);
  });

  it("小さいサイズ（スマホ読み取り相当の解像度）でも読み取れる", async () => {
    expect(decode(await qrPngBytes(url, 240))).toBe(url);
  });

  it("SVG の data URL を生成する", async () => {
    const dataUrl = await qrSvgDataUrl(url);
    expect(dataUrl.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const svg = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1));
    expect(svg).toContain("<svg");
    // URL 文字列そのものは画像のテキストとして埋め込まれない
    expect(svg).not.toContain(url);
  });
});

describe("印刷用 PDF", () => {
  const token = generateToken();
  const url = buildRedeemUrl("https://example.com", token);

  it("A4 1ページで、識別番号をタイトルに持ち、トークンや URL を文字として含まない", async () => {
    const bytes = await createQrPdf({ redeemUrl: url, serialLabel: "QR-000123" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    expect(doc.getTitle()).toBe("QR-000123");

    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).not.toContain(token);
    expect(raw).not.toContain("redeem");
    expect(raw).not.toContain(url);
  });

  it("QR 画像が1つ埋め込まれ、印刷に十分な解像度を持つ", async () => {
    const bytes = await createQrPdf({ redeemUrl: url, serialLabel: "QR-000123" });
    const doc = await PDFDocument.load(bytes);
    const images = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
    expect(images).toHaveLength(1);
    const width = Number(images[0].dict.get(PDFName.of("Width"))?.toString());
    // 印刷時に十分な解像度（50mm で 600dpi 以上相当）
    expect(width).toBeGreaterThanOrEqual(1000);
  });
});
