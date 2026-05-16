"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Header business switcher. Replaces the sidebar "Businesses" entry per
// Product council § 4. When the user has 0 businesses the layout
// redirects to onboarding, but we still defensively render a static
// "no business" label (council Q6) so the header isn't visually broken
// during the brief redirect frame.
//
// The switcher does NOT mutate server-side "active business" — that
// concept doesn't exist yet (most users have a single business). We
// link each entry to /businesses/{id} so the user reviews / edits the
// business profile. When multi-business support arrives, swap the
// click handler to a server-action that stamps a cookie or session.

export type SwitcherBusiness = {
  id: string;
  legalName: string;
  kind: "owned" | "engaged";
};

type Props = {
  businesses: SwitcherBusiness[];
  /** Which business is currently active. Optional — caller passes
   *  null and we default to the first owned business if any. */
  activeBusinessId?: string | null;
};

export default function BusinessSwitcher({
  businesses,
  activeBusinessId,
}: Props) {
  const t = useTranslations("app.shell.businessSwitcher");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Empty state: static label, no chevron, no click handler. Layout
  // is already redirecting to /onboarding — this is purely defensive.
  if (businesses.length === 0) {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-400"
        aria-label={t("emptyAria")}
      >
        <Building2 size={13} className="text-slate-500" />
        <span className="max-w-[160px] truncate">{t("empty")}</span>
      </div>
    );
  }

  const active =
    businesses.find((b) => b.id === activeBusinessId) ?? businesses[0]!;

  return (
    <div ref={ref} className="relative">
      <motion.button
        type="button"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex max-w-[200px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10"
      >
        <Building2 size={13} className="text-emerald-300" />
        <span className="truncate">{active.legalName}</span>
        <ChevronDown size={12} className="text-slate-400" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="glass-strong absolute end-0 mt-2 min-w-[240px] overflow-hidden rounded-xl p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6)]"
          >
            <div className="px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
              {t("heading")}
            </div>
            <ul className="flex flex-col gap-0.5">
              {businesses.map((b) => {
                const isActive = b.id === active.id;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        // No-op for v1 — we don't yet support an
                        // "active business" cookie. Close the menu so
                        // the user gets visual feedback.
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-emerald-500/10 text-emerald-100"
                          : "text-slate-200 hover:bg-white/5"
                      }`}
                    >
                      <Building2
                        size={13}
                        className={
                          isActive ? "text-emerald-300" : "text-slate-400"
                        }
                      />
                      <span className="flex-1 truncate text-start">
                        {b.legalName}
                      </span>
                      {b.kind === "engaged" ? (
                        <span className="rounded-full bg-slate-800/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-400">
                          {t("kindEngaged")}
                        </span>
                      ) : null}
                      {isActive ? (
                        <Check size={13} className="text-emerald-300" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="my-1 border-t border-white/5" />
            <a
              href="/businesses"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            >
              {t("manage")}
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
