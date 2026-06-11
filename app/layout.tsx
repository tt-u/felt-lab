import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "http://blockinsight.top/felt-lab";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "翻牌屋 FELT LAB | 德州扑克对战训练",
  description:
    "和 GTO 或带性格偏移的策略对手实战德州扑克: 每手实时拆解决策点(对手范围/胜率/建议), 弃牌后兔子洞看反事实, 整局生成行为模式复盘。",
  openGraph: {
    title: "翻牌屋 FELT LAB",
    description: "德州扑克对战训练: 实时决策拆解 · 兔子洞复盘 · 行为模式分析",
    images: ["/og.jpg"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "翻牌屋 FELT LAB",
    description: "德州扑克对战训练: 实时决策拆解 · 兔子洞复盘 · 行为模式分析",
    images: ["/og.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <div className="grain" aria-hidden="true" />
      </body>
    </html>
  );
}
