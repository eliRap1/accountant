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

export const metadata: Metadata = {
  title: "AccounTech — Precision & Transparency",
  description:
    "Modern accounting, audit, tax, and strategic consulting — engineered with precision and delivered with transparency.",
  metadataBase: new URL("https://accountech.example.com"),
  openGraph: {
    title: "AccounTech — Precision & Transparency",
    description:
      "Audit, tax, and consulting for ambitious companies. Built on data, delivered with clarity.",
    url: "https://accountech.example.com",
    type: "website",
    images: [
      {
        url: "https://accountech.example.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "AccounTech — Precision & Transparency",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AccounTech — Precision & Transparency",
    description:
      "Audit, tax, and consulting for ambitious companies. Built on data, delivered with clarity.",
    images: ["https://accountech.example.com/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
