"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { Target, Database, FileCheck, Compass } from "lucide-react";
import { useT, useLocale } from "../i18n/LanguageProvider";

export default function Approach() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const lineProgress = useTransform(scrollYProgress, [0.1, 0.9], [0, 1]);
  const t = useT();
  const { locale } = useLocale();
  const isRtl = locale === "he";

  const steps = [
    { icon: Compass, title: t.approach.s1.title, desc: t.approach.s1.desc },
    { icon: Database, title: t.approach.s2.title, desc: t.approach.s2.desc },
    { icon: FileCheck, title: t.approach.s3.title, desc: t.approach.s3.desc },
    { icon: Target, title: t.approach.s4.title, desc: t.approach.s4.desc },
  ];

  return (
    <section id="approach" ref={ref} className="relative mx-auto w-full max-w-7xl px-6 py-32">
      <div className="mb-16 max-w-2xl">
        <span className="text-xs uppercase tracking-[0.22em] text-emerald-400">
          {t.approach.eyebrow}
        </span>
        <h2 className="mt-3 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl">
          {t.approach.title}
        </h2>
      </div>

      <div className="relative grid gap-6 md:grid-cols-4">
        <div className="pointer-events-none absolute inset-x-0 top-7 hidden md:block">
          <div className="relative mx-auto h-px w-full bg-white/5">
            <motion.span
              style={{
                scaleX: lineProgress,
                transformOrigin: isRtl ? "100% 50%" : "0% 50%",
              }}
              className="absolute inset-y-0 inset-x-0 block bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500"
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
              <div className="mb-2 font-mono text-xs text-slate-500" dir="ltr">
                0{i + 1}
              </div>
              <h3 className="text-lg font-semibold tracking-tight text-slate-50">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
