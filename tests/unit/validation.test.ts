import { describe, expect, it } from "vitest";
import { validateAddress } from "@/lib/validation/address";

const valid = {
  recipient_name: " 山田 太郎 ",
  postal_code: "１００－０００１",
  prefecture: "東京都",
  city: "千代田区",
  address_line: "千代田１－１",
  building: "",
  phone: "090-1234-5678",
};

describe("住所の入力検証", () => {
  it("正規化して受け付ける（全角数字・ハイフン・前後空白）", () => {
    const r = validateAddress(valid);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual({
      recipient_name: "山田 太郎",
      postal_code: "100-0001",
      prefecture: "東京都",
      city: "千代田区",
      address_line: "千代田1-1",
      building: "",
      phone: "09012345678",
    });
  });

  it("郵便番号はハイフンなしでもよい", () => {
    const r = validateAddress({ ...valid, postal_code: "1000001" });
    expect(r.success && r.data.postal_code).toBe("100-0001");
  });

  it("建物名は省略できる", () => {
    const { building: _b, ...rest } = valid;
    void _b;
    expect(validateAddress(rest).success).toBe(true);
  });

  it.each([
    ["recipient_name", "", "氏名を入力してください"],
    ["recipient_name", "   ", "氏名を入力してください"],
    ["recipient_name", "あ".repeat(101), "氏名は100文字以内で入力してください"],
    ["recipient_name", "山田\u0000太郎", "氏名に使用できない文字が含まれています"],
    ["recipient_name", "山田‮太郎", "氏名に使用できない文字が含まれています"],
    ["postal_code", "", "郵便番号を入力してください"],
    ["postal_code", "123-456", "郵便番号は7桁の数字で入力してください（例: 100-0001）"],
    ["prefecture", "", "都道府県を選択してください"],
    ["prefecture", "架空県", "都道府県を選択してください"],
    ["city", "", "市区町村を入力してください"],
    ["address_line", "", "番地を入力してください"],
    ["building", "あ".repeat(201), "建物名・部屋番号は200文字以内で入力してください"],
    ["phone", "", "電話番号を入力してください"],
    ["phone", "12345", "電話番号は0から始まる10〜11桁の数字で入力してください"],
    ["phone", "090-1234-56789", "電話番号は0から始まる10〜11桁の数字で入力してください"],
  ])("%s=%j はエラー", (field, value, message) => {
    const r = validateAddress({ ...valid, [field]: value });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.fieldErrors[field as keyof typeof r.fieldErrors]).toBe(message);
  });

  it("必須項目の欠落・型違いもエラーにする", () => {
    const r = validateAddress({ recipient_name: 1 });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(Object.keys(r.fieldErrors).sort()).toEqual(
      ["address_line", "city", "phone", "postal_code", "prefecture", "recipient_name"].sort(),
    );
  });

  it("オブジェクト以外は拒否する", () => {
    expect(validateAddress(null).success).toBe(false);
    expect(validateAddress("x").success).toBe(false);
  });
});
