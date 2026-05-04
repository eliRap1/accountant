"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import GlareCard from "../ui/GlareCard";
import { ScanSearch, Calculator, LineChart, ArrowUpRight } from "lucide-react";

const services = [
  {
    icon: ScanSearch,
    title: "Audit & Assurance",
    desc: "Risk-driven audits with continuous evidence collection. We ship findings in days, not quarters.",
    bullets: ["SOC 1 / SOC 2", "Public-co quality at private-co speed", "Audit data analytics"],
    tag: "01",
  },
  {
    icon: Calculator,
    title: "Tax Planning",
    desc: "Multi-jurisdiction strategy. R&D credits, transfer pricing, and exit-aware structures—proactively modeled.",
    bullets: ["Federal & state filings", "International structuring", "Real-time provisioning"],
    tag: "02",
  },
  {
    icon: LineChart,
    title: "Strategic Consulting",
    desc: "Forecasting, FP&A, and finance leadership on demand. We become the operating system of your finance team.",
    bullets: ["Driver-based forecasts", "Fractional CFO", "M&A diligence"],
    tag: "03",
  },
];

export default function Services() {
  const wrap = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: wrap,
    offset: ["start end", "end start"],
  });
  const headerY = useTransform(scrollYProgress, [0, 1], [60, -60]);
  const headerOpacity = useTransform(scrollYProgress, [0, 0.25, 0.85, 1], [0.2, 1, 1, 0.4]);

  return (
    <section ref={wrap} id="services" className="relative mx-auto w-full max-w-7xl px-6 py-32">
      <motion.div style={{ y: headerY, opacity: headerOpacity }} className="mb-16 max-w-2xl">
        <span className="text-xs uppercase tracking-[0.22em] text-emerald-400">Practice areas</span>
        <h2 className="mt-3 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl md:text-6xl">
          Three disciplines.{" "}
          <span className="text-gradient">One source of truth.</span>
        </h2>
        <p className="mt-5 text-base text-slate-400 sm:text-lg">
          A unified data spine connects audit, tax, and consulting—so your numbers stay
          consistent across every filing, forecast, and board deck.
        </p>
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
                    <span className="font-mono text-xs text-slate-500">{s.tag}</span>
                    <ArrowUpRight
                      size={18}
                      className="text-slate-600 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-emerald-300"
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
