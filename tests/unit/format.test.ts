import { describe, expect, it } from "vitest";
import { formatDateTime, formatSerial, parseSerial } from "@/lib/format";

describe("識別番号", () => {
  it("表示形式", () => {
    expect(formatSerial(12)).toBe("QR-000012");
    expect(formatSerial(1234567)).toBe("QR-1234567");
  });
  it.each([
    ["QR-000012", 12],
    ["qr-12", 12],
    ["000012", 12],
    ["12", 12],
    ["ＱＲ－０００１２", 12],
  ])("%s を解析できる", (input, expected) => {
    expect(parseSerial(input)).toBe(expected);
  });
  it.each(["", "abc", "QR-", "0", "QR-1; drop table", "1.5"])("%j は不正", (input) => {
    expect(parseSerial(input)).toBeNull();
  });
});

describe("日時表示", () => {
  it("日本時間で表示する", () => {
    expect(formatDateTime("2026-01-01T00:00:00Z")).toBe("2026/01/01 09:00");
    expect(formatDateTime(null)).toBe("—");
  });
});
