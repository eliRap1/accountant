import type { Route } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import {
  type LucideIcon,
  KeyRound,
  Languages,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wallet,
} from "lucide-react";
import { routing } from "@/i18n/routing";
import { requireCurrentUser } from "@/lib/auth/serverSession";

export const metadata = {
  title: "Settings · AccounTech",
};

type CardLink = {
  href: Route | string;
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
};

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect(`/${routing.defaultLocale}/settings` as Route);
  }
  setRequestLocale(locale);
  const me = await requireCurrentUser();
  const t = await getTranslations("app.settings");

  const cards: CardLink[] = [
    {
      href: `/${locale}/businesses`,
      icon: Wallet,
      titleKey: "businesses.title",
      descKey: "businesses.desc",
    },
    {
      href: `/${locale}/billing`,
      icon: Sparkles,
      titleKey: "billing.title",
      descKey: "billing.desc",
    },
    {
      href: `/${locale}/2fa/enroll`,
      icon: ShieldCheck,
      titleKey: "twoFactor.title",
      descKey: "twoFactor.desc",
    },
    {
      href: `/${locale}/passkeys`,
      icon: KeyRound,
      titleKey: "passkeys.title",
      descKey: "passkeys.desc",
    },
    {
      href: `/${locale}/recovery-codes`,
      icon: ShieldCheck,
      titleKey: "recoveryCodes.title",
      descKey: "recoveryCodes.desc",
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-slate-400">{t("pageSubtitle")}</p>
      </header>

      <section className="rounded-2xl border border-white/5 bg-slate-950/50 p-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-200"
            dir="ltr"
          >
            <UserRound size={18} />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-slate-100">
              {me.name ?? me.email}
            </span>
            <span className="text-xs text-slate-400" dir="ltr">
              {me.email}
            </span>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500">{t("profile.editHint")}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.href.toString()}
              href={c.href as Route}
              className="group flex items-start gap-3 rounded-2xl border border-white/5 bg-slate-950/40 p-4 transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/5"
            >
              <span className="rounded-lg bg-emerald-500/15 p-2 text-emerald-300 transition-transform group-hover:scale-105">
                <Icon size={16} />
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-slate-100">
                  {t(c.titleKey)}
                </span>
                <span className="mt-0.5 text-xs text-slate-400">
                  {t(c.descKey)}
                </span>
              </div>
            </Link>
          );
        })}
      </section>

      <section className="rounded-2xl border border-white/5 bg-slate-950/40 p-5">
        <div className="flex items-center gap-2 text-slate-200">
          <Languages size={16} className="text-emerald-300" />
          <h2 className="text-sm font-semibold tracking-tight">
            {t("locale.title")}
          </h2>
        </div>
        <p className="mt-2 text-xs text-slate-400">{t("locale.desc")}</p>
      </section>
    </div>
  );
}
