import type { Metadata } from "next";
import { Geist, Geist_Mono, Heebo, Manrope } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import "../globals.css";
import { routing } from "@/i18n/routing";

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
    "Israeli tax invoices, receipt OCR, VAT estimates and ready-to-upload SHAAM files for עוסק פטור / עוסק מורשה / ח.פ. Estimates only — not tax advice.",
  metadataBase: new URL("https://accountech.example.com"),
  openGraph: {
    title: "AccounTech — Precision & Transparency",
    description:
      "Self-serve accounting for Israeli self-employed. Built on data, delivered with clarity.",
    type: "website",
  },
};

// Pre-render every locale at build time so the [locale] segment is
// effectively static — required for `setRequestLocale` to enable
// static rendering of nested server components per the next-intl docs.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleRootLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = await getMessages();
  const langAttr = locale.split("-")[0] ?? "he";
  const isRtl = locale === "he-IL";

  return (
    <html
      lang={langAttr}
      dir={isRtl ? "rtl" : "ltr"}
      className={`${geistSans.variable} ${geistMono.variable} ${heebo.variable} ${manrope.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
