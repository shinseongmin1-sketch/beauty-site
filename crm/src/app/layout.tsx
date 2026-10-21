import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "매니온 | 예약관리프로그램",
  description: "매장 직원 · 고객 · 예약 · 결제를 한 곳에서 관리하는 예약 프로그램",
  applicationName: "매니온",
  // 아이폰·아이패드에서 "홈 화면에 추가"한 아이콘을 누르면 주소창 없이 앱처럼 열리게 한다.
  appleWebApp: { capable: true, title: "매니온", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f6f8fc",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
