import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const arabicFont = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Benuuprint",
    template: "%s | Benuuprint",
  },
  description: "نظام إدارة Benuuprint للطباعة وتصنيع الملابس",
  applicationName: "Benuuprint ERP",
  appleWebApp: {
    capable: true,
    title: "Benuuprint",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  // Internal tool: keep it out of search engines.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#4b1fa0",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${arabicFont.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
