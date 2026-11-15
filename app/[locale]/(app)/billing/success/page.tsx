import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import BillingSuccessView from "./BillingSuccessView";
import { routing } from "@/i18n/routing";

export const metadata = {
  title: "Billing · AccounTech",
};

export default async function BillingSuccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);

  return <BillingSuccessView locale={locale} />;
}
