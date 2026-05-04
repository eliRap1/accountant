import type { Metadata } from "next";
import { Geist, Geist_Mono, Heebo, Manrope } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";

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
  title: "AccounTech — Precision & Transparency",
  description:
    "Modern accounting, audit, tax, and strategic consulting — engineered with precision and delivered with transparency.",
  metadataBase: new URL("https://accountech.example.com"),
  openGraph: {
    title: "AccounTech — Precision & Transparency",
    description:
      "Audit, tax, and consulting for ambitious companies. Built on data, delivered with clarity.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${geistSans.variable} ${geistMono.variable} ${heebo.variable} ${manrope.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script src="/locale-init.js" strategy="beforeInteractive" />
      </head>
      <body className="min-h-full flex flex-col">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
