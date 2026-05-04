"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import dynamic from "next/dynamic";
import { useRef } from "react";
import Button from "../ui/Button";
import { ArrowRight, ShieldCheck } from "lucide-react";

const HeroScene = dynamic(() => import("../canvas/HeroScene"), {
  ssr: false,
  loading: () => <div className="absolute inset-0" />,
});

export default function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 220]);
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.92]);

  return (
    <section
      ref={ref}
      id="top"
      className="relative isolate flex min-h-[100svh] w-full items-center justify-center overflow-hidden pt-28"
    >
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10" />

      {/* 3D canvas layer */}
      <div className="pointer-events-auto absolute inset-0 -z-10">
        <HeroScene />
      </div>

      {/* Soft vignette to lift text */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_55%,rgba(2,6,23,0.0)_0%,rgba(2,6,23,0.55)_55%,#020617_85%)]"
      />

      <motion.div
        style={{ y, opacity, scale }}
        className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-6 text-center"
      >
        <motion.span
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="glass mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs uppercase tracking-[0.18em] text-emerald-300"
        >
          <ShieldCheck size={14} />
          PCAOB · AICPA · ISO 27001
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          className="max-w-4xl text-balance text-5xl font-semibold leading-[1.02] tracking-tight text-slate-50 sm:text-6xl md:text-7xl"
        >
          Accounting,{" "}
          <span className="text-gradient">engineered</span>
          <br />
          for the next decade.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45 }}
          className="mt-6 max-w-xl text-balance text-base leading-relaxed text-slate-300 sm:text-lg"
        >
          Audit, tax and strategic finance, delivered through a real-time data platform.
          Less paperwork. More clarity. Compounding precision.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4"
        >
          <Button variant="primary" withArrow className="group">
            Start your engagement
          </Button>
          <Button variant="ghost">
            <span className="inline-flex items-center gap-2">
              See live dashboard <ArrowRight size={16} />
            </span>
          </Button>
        </motion.div>

        {/* KPI strip */}
        <motion.dl
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.85 }}
          className="glass mt-16 grid w-full max-w-3xl grid-cols-3 divide-x divide-white/10 rounded-2xl p-4"
        >
          {[
            { k: "$4.2B", v: "Assets audited" },
            { k: "98.6%", v: "Filing accuracy" },
            { k: "<24h", v: "Avg. issue resolution" },
          ].map((s) => (
            <div key={s.v} className="px-4 text-left first:pl-2 last:pr-2">
              <dt className="text-2xl font-semibold tracking-tight text-emerald-300 sm:text-3xl">
                {s.k}
              </dt>
              <dd className="mt-1 text-[11px] uppercase tracking-[0.16em] text-slate-400 sm:text-xs">
                {s.v}
              </dd>
            </div>
          ))}
        </motion.dl>
      </motion.div>

      {/* Scroll cue */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] text-slate-500"
      >
        <motion.span
          animate={{ y: [0, 6, 0] }}
          transition={{ repeat: Infinity, duration: 2.4 }}
          className="inline-block"
        >
          scroll ↓
        </motion.span>
      </motion.div>
    </section>
  );
}
