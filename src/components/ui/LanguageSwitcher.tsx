"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Globe, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { translations, locales, type Locale } from "../i18n/translations";
import { useLocale } from "../i18n/LanguageProvider";

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();
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

  const current = translations[locale].meta;

  return (
    <div ref={ref} className="relative">
      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change language"
        className={`group inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10 ${compact ? "" : ""}`}
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
            {locales.map((l) => {
              const m = translations[l].meta;
              const active = l === locale;
              return (
                <li key={l}>
                  <button
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setLocale(l as Locale);
                      setOpen(false);
                    }}
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
