"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useT, useLocale } from "../i18n/LanguageProvider";

export default function StickyCTA() {
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0, 0.06, 0.95, 1], [0, 1, 1, 0]);
  const y = useTransform(scrollYProgress, [0, 0.06], [40, 0]);
  const t = useT();
  const { locale } = useLocale();
  const isRtl = locale === "he";

  return (
    <motion.a
      href="#contact"
      style={{ opacity, y }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      className={`fixed bottom-6 ${isRtl ? "left-6" : "right-6"} z-40 hidden items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-5 py-3 text-sm font-medium text-emerald-100 shadow-[0_10px_50px_-10px_rgba(16,185,129,0.6)] backdrop-blur-xl md:inline-flex`}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      <Sparkles size={15} className="text-emerald-300" />
      {t.sticky.label}
    </motion.a>
  );
}
