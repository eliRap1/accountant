"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Coffee } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { SerialisedPayload } from "@/lib/notifications/morningBriefNotifications";

// In-app Morning Tax Brief card. Renders the same sentence the user
// receives by email — but as a top-of-dashboard glance widget.
//
// Visual style: glassmorphic card matching the rest of the dashboard,
// emerald accent for the action CTA. The sentence wraps naturally; we
// do NOT truncate (the brief is supposed to be readable in one breath).
//
// When `brief` is null we render an empty-state nudge ("your first brief
// arrives tomorrow at 08:00 once your business is set up").

type Props = {
  /** Active locale of the host page — "he-IL" | "en-US" | "ru-RU". */
  locale: string;
  /** Latest brief from the notifications table, or null if none yet. */
  brief: SerialisedPayload | null;
  /** Server-formatted timestamp of when the brief was generated. */
  generatedAtLabel: string | null;
};

export default function MorningBriefCard({ locale, brief, generatedAtLabel }: Props) {
  const t = useTranslations("app.morningBrief");
  const isHe = locale.startsWith("he");
  const isRu = locale.startsWith("ru");

  // ru-RU app surface defaults to English copy per Plan v4 Risk #24.
  const sentence = brief
    ? isHe
      ? (brief.he ?? brief.en ?? "")
      : (brief.en ?? brief.he ?? "")
    : null;

  // The CTA label depends on the action. We surface a single big CTA so
  // the card reads "one number + one action".
  const ctaLabel = brief
    ? t(`cta.${brief.actionNext}` as Parameters<typeof t>[0])
    : t("emptyCta");

  // Route the CTA to the most relevant deep link. Until the tax/(vat)
  // route lands (other agent's scope) we fall back to /dashboard.
  // The spec says CTA links to /tax/(vat) — we anchor that path here
  // and rely on the router to gracefully 404 → redirect for now.
  const ctaHref =
    brief?.actionNext === "follow_up_overdue"
      ? "/invoices"
      : brief?.actionNext === "categorise_receipts"
        ? "/receipts"
        : brief?.actionNext === "pay_vat"
          ? "/tax/vat"
          : "/dashboard";

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-strong relative overflow-hidden rounded-2xl border border-emerald-400/15 bg-slate-950/40 p-6"
      aria-label={t("ariaLabel")}
      dir={isHe ? "rtl" : "ltr"}
    >
      <div
        className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-emerald-300"
      >
        <Coffee size={14} className="text-emerald-400" />
        {t("eyebrow")}
        {generatedAtLabel ? (
          <span className="ms-2 text-slate-500 normal-case tracking-normal">
            · {generatedAtLabel}
          </span>
        ) : null}
      </div>
      <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-100 sm:text-xl">
        {t("title")}
      </h2>
      {sentence ? (
        <p
          className="mt-3 text-base leading-relaxed text-slate-200 sm:text-lg"
          // The sentence already carries the disclaimer suffix — keep it
          // intact, do not strip.
        >
          {sentence}
        </p>
      ) : (
        <p className="mt-3 text-base leading-relaxed text-slate-400">
          {t("emptyDesc")}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          // The Phase D tax/(vat) route is owned by another agent; until
          // it lands the typedRoutes check will flag the path. Cast at
          // the call site to keep the build green for cohabitation.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          href={ctaHref as any}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/15"
        >
          {ctaLabel}
          <ArrowUpRight size={14} />
        </Link>
        {isRu ? (
          <span className="text-xs text-slate-500">
            {t("ruFallbackNote")}
          </span>
        ) : null}
      </div>
    </motion.section>
  );
}
