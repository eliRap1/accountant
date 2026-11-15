"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Eye } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Transparency disclosure for the AI advisor. Shows the user the EXACT
// redacted snapshot the model sees before it answers — surfaces the
// data the model is reasoning over so the user can audit the system's
// privacy footprint. Mirrors the legal-banner doctrine: be explicit
// about what we send to the model, never hidden.

type Props = {
  preview: string;
};

export default function SnapshotDisclosure({ preview }: Props) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("app.ai.snapshot");

  return (
    <div className="rounded-2xl border border-white/5 bg-slate-950/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-sm text-slate-200 transition-colors hover:bg-white/5"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-emerald-300" aria-hidden />
          {t("toggle")}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18 }}
        >
          <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/5 px-4 py-3 text-xs leading-relaxed text-slate-300">
              <p className="mb-2 text-slate-400">{t("description")}</p>
              <pre
                className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950/80 p-3 font-mono text-[11px] text-slate-200"
                dir="ltr"
              >
                {preview}
              </pre>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
