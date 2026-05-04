"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { Target, Database, FileCheck, Compass } from "lucide-react";

const steps = [
  {
    icon: Compass,
    title: "Discovery",
    desc: "We map your entities, ledgers, and risk surface in week one.",
  },
  {
    icon: Database,
    title: "Data spine",
    desc: "Direct ERP & bank connections feed a live, audit-ready warehouse.",
  },
  {
    icon: FileCheck,
    title: "Continuous assurance",
    desc: "Anomaly checks run every night—not once a quarter.",
  },
  {
    icon: Target,
    title: "Strategic counsel",
    desc: "Quarterly reviews translate the numbers into decisions.",
  },
];

export default function Approach() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const lineProgress = useTransform(scrollYProgress, [0.1, 0.9], [0, 1]);

  return (
    <section id="approach" ref={ref} className="relative mx-auto w-full max-w-7xl px-6 py-32">
      <div className="mb-16 max-w-2xl">
        <span className="text-xs uppercase tracking-[0.22em] text-emerald-400">Approach</span>
        <h2 className="mt-3 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl">
          A four-stage operating model.
        </h2>
      </div>

      <div className="relative grid gap-6 md:grid-cols-4">
        {/* Progress line (desktop) */}
        <div className="pointer-events-none absolute left-0 right-0 top-7 hidden md:block">
          <div className="relative mx-auto h-px w-full bg-white/5">
            <motion.span
              style={{ scaleX: lineProgress, transformOrigin: "0% 50%" }}
              className="absolute inset-y-0 left-0 right-0 block bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500"
            />
          </div>
        </div>

        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: i * 0.08 }}
              className="relative rounded-2xl border border-white/5 bg-slate-900/40 p-6 backdrop-blur"
            >
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
                <Icon size={22} />
              </div>
              <div className="mb-2 font-mono text-xs text-slate-500">0{i + 1}</div>
              <h3 className="text-lg font-semibold tracking-tight text-slate-50">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
