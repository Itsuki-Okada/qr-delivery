import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "お届け先のご登録",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default function RedeemLayout({ children }: { children: React.ReactNode }) {
  return children;
}
