import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "../context/AppContext";
import { ToastProvider } from "../components/Toast";

export const metadata: Metadata = {
  title: "阅译 · AI Book Translator",
  description: "安静、顺手的双栏外文精读与跨页伴读书摘工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <body>
        <AppProvider>
          <ToastProvider>{children}</ToastProvider>
        </AppProvider>
      </body>
    </html>
  );
}
