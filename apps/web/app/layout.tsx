import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeLab · demo trading terminal",
  description: "An educational paper-trading simulator. All funds are virtual.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d1218" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
