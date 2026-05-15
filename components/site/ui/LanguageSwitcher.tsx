"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Globe, Check } from "lucide-react";
import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

// Each locale's chrome is now hard-coded here rather than living in the
// translation JSON — the values are stable identity metadata and we
// avoid pulling all three message bundles just to render the dropdown.
const LOCALE_META: Record<AppLocale, { label: string; short: string; flag: string }> = {
  "he-IL": { label: "עברית", short: "HE", flag: "🇮🇱" },
  "en-US": { label: "English", short: "EN", flag: "🇺🇸" },
  "ru-RU": { label: "Русский", short: "RU", flag: "🇷🇺" },
};

// `useSearchParams()` triggers Next.js's CSR-bailout rule during static
// prerender, so we wrap the inner switcher in a Suspense boundary.
// The fallback renders the current-locale chip without query-preservation
// — that's fine for the first paint; on hydration the real component
// takes over and gains the qs handling.
export default function LanguageSwitcher(props: { compact?: boolean }) {
  return (
    <Suspense fallback={<LanguageSwitcherChip />}>
      <LanguageSwitcherInner {...props} />
    </Suspense>
  );
}

function LanguageSwitcherChip() {
  return (
    <span
      aria-hidden
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-slate-200"
    >
      <Globe size={15} className="text-emerald-300" />
    </span>
  );
}

function LanguageSwitcherInner({ compact = false }: { compact?: boolean }) {
  // `useLocale()` is the current segment value. `usePathname()` from
  // i18n/navigation returns the path *without* the locale prefix, so
  // switching is just `router.replace(pathname, { locale: target })`.
  const activeLocale = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function switchTo(target: AppLocale) {
    setOpen(false);
    if (target === activeLocale) return;

    // Preserve query string (e.g. `?email=…&token=…`). The next-intl
    // router accepts a plain string here because we don't configure
    // localized `pathnames` — locales are prefix-only.
    const qs = searchParams?.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;

    startTransition(() => {
      router.replace(href, { locale: target });
    });
  }

  const current = LOCALE_META[activeLocale];

  return (
    <div ref={ref} className="relative">
      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change language"
        disabled={isPending}
        className={`group inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10 disabled:opacity-60 ${compact ? "" : ""}`}
      >
        <Globe size={15} className="text-emerald-300" />
        <span className="font-mono text-[11px] tracking-wider">{current.short}</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="glass-strong absolute end-0 mt-2 min-w-[180px] overflow-hidden rounded-xl p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6)]"
          >
            {routing.locales.map((l) => {
              const m = LOCALE_META[l];
              const active = l === activeLocale;
              return (
                <li key={l}>
                  <button
                    role="option"
                    aria-selected={active}
                    onClick={() => switchTo(l)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-emerald-500/15 text-emerald-200"
                        : "text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="text-base leading-none">
                        {m.flag}
                      </span>
                      <span className="font-medium">{m.label}</span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {m.short}
                      </span>
                    </span>
                    {active && <Check size={14} className="text-emerald-400" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
