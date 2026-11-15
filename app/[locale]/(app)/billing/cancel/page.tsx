import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export const metadata = {
  title: "Billing · AccounTech",
};

export default async function BillingCancelPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);
  const t = await getTranslations("app.billing.cancel");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-slate-100">{t("title")}</h1>
      <p className="text-sm text-slate-400">{t("desc")}</p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/billing"
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
        >
          {t("backToBilling")}
        </Link>
      </div>
    </div>
  );
}
