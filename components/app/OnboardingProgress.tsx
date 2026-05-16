"use client";

import { motion } from "framer-motion";

// 3-dot step indicator for the onboarding wizard. The active step
// gets an animated emerald glow; completed steps stay solid; future
// steps render as outline dots.
type Props = {
  current: 1 | 2 | 3;
  labels: [string, string, string];
};

export default function OnboardingProgress({ current, labels }: Props) {
  const steps = [1, 2, 3] as const;
  return (
    <div className="flex w-full items-center justify-center gap-3 sm:gap-5">
      {steps.map((step, i) => {
        const state =
          step < current ? "done" : step === current ? "active" : "future";
        return (
          <div key={step} className="flex items-center gap-3 sm:gap-5">
            <div className="flex flex-col items-center gap-2">
              <motion.span
                initial={false}
                animate={
                  state === "active"
                    ? {
                        scale: [1, 1.12, 1],
                        boxShadow: [
                          "0 0 0 0 rgba(16,185,129,0)",
                          "0 0 0 8px rgba(16,185,129,0.18)",
                          "0 0 0 0 rgba(16,185,129,0)",
                        ],
                      }
                    : { scale: 1, boxShadow: "0 0 0 0 rgba(16,185,129,0)" }
                }
                transition={{
                  duration: 1.8,
                  repeat: state === "active" ? Infinity : 0,
                  ease: "easeInOut",
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
                  state === "done"
                    ? "bg-emerald-500/90 text-slate-950"
                    : state === "active"
                      ? "bg-emerald-500 text-slate-950"
                      : "border border-white/15 bg-slate-950/60 text-slate-500"
                }`}
                aria-current={state === "active" ? "step" : undefined}
              >
                {step}
              </motion.span>
              <span
                className={`text-[11px] tracking-wide ${
                  state === "future" ? "text-slate-500" : "text-slate-300"
                }`}
              >
                {labels[i]}
              </span>
            </div>
            {step < 3 && (
              <span
                aria-hidden
                className={`mb-5 h-px w-8 sm:w-12 ${
                  step < current ? "bg-emerald-500/70" : "bg-white/10"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
