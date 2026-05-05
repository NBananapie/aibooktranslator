import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI PDF Translator",
  description: "Real-time bilingual PDF translation powered by AI.",
};

import { AppProvider } from "../context/AppContext";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
