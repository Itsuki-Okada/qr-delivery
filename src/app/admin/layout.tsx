import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "管理画面 | QRコード配送管理",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
