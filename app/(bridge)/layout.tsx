import type { Metadata } from "next";
import { Geist, Geist_Mono, Heebo, Manrope } from "next/font/google";
import "../globals.css";

// This is a *second* root layout used only for paths outside the
// `[locale]` segment — currently just `/post-auth`, which is a synchronous
// auth-bridge that immediately redirects to a localised route. Per the
// Next.js 16 docs (file-conventions/layout.md §Root Layout) multiple
// root layouts are supported; navigating between them triggers a full
// page load, which is the desired behaviour for an auth bridge.
//
// Real i18n + locale-aware `<html lang dir>` lives in `app/[locale]/layout.tsx`.
// Here we default to `lang="he" dir="rtl"` because the AccounTech audience
// is IL-first and the bridge page only renders for a few hundred ms.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["latin", "hebrew"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AccounTech",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${geistSans.variable} ${geistMono.variable} ${heebo.variable} ${manrope.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
