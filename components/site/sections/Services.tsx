"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import GlareCard from "../ui/GlareCard";
import { ScanSearch, Calculator, LineChart, ArrowUpRight } from "lucide-react";
import { useT, useLocale } from "../i18n/LanguageProvider";

export default function Services() {
  const wrap = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: wrap,
    offset: ["start end", "end start"],
  });
  const headerY = useTransform(scrollYProgress, [0, 1], [60, -60]);
  const headerOpacity = useTransform(scrollYProgress, [0, 0.25, 0.85, 1], [0.2, 1, 1, 0.4]);
  const t = useT();
  const { locale } = useLocale();
  const isRtl = locale === "he";

  const services = [
    {
      icon: ScanSearch,
      title: t.services.audit.title,
      desc: t.services.audit.desc,
      bullets: [t.services.audit.b1, t.services.audit.b2, t.services.audit.b3],
      tag: "01",
    },
    {
      icon: Calculator,
      title: t.services.tax.title,
      desc: t.services.tax.desc,
      bullets: [t.services.tax.b1, t.services.tax.b2, t.services.tax.b3],
      tag: "02",
    },
    {
      icon: LineChart,
      title: t.services.consulting.title,
      desc: t.services.consulting.desc,
      bullets: [t.services.consulting.b1, t.services.consulting.b2, t.services.consulting.b3],
      tag: "03",
    },
  ];

  return (
    <section ref={wrap} id="services" className="relative mx-auto w-full max-w-7xl px-6 py-32">
      <motion.div style={{ y: headerY, opacity: headerOpacity }} className="mb-16 max-w-2xl">
        <span className="text-xs uppercase tracking-[0.22em] text-emerald-400">
          {t.services.eyebrow}
        </span>
        <h2 className="mt-3 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl md:text-6xl">
          {t.services.title1}{" "}
          <span className="text-gradient">{t.services.titleAccent}</span>
        </h2>
        <p className="mt-5 text-base text-slate-400 sm:text-lg">{t.services.desc}</p>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-3">
        {services.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 60 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
            >
              <GlareCard className="h-full">
                <div className="flex h-full flex-col gap-5 p-7">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-slate-500" dir="ltr">
                      {s.tag}
                    </span>
                    <ArrowUpRight
                      size={18}
                      className={`text-slate-600 transition-all group-hover:-translate-y-0.5 group-hover:text-emerald-300 ${
                        isRtl ? "group-hover:-translate-x-0.5 -scale-x-100" : "group-hover:translate-x-0.5"
                      }`}
                    />
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 shadow-[inset_0_0_30px_-10px_rgba(16,185,129,0.5)]">
                    <Icon size={22} />
                  </div>
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-50">
                    {s.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-400">{s.desc}</p>
                  <ul className="mt-auto space-y-2 border-t border-white/5 pt-4">
                    {s.bullets.map((b) => (
                      <li key={b} className="flex items-center gap-2 text-sm text-slate-300">
                        <span className="h-1 w-1 rounded-full bg-emerald-400" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </GlareCard>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
