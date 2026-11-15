"use client";

import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { useRef, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export default function GlareCard({ children, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(-200);
  const mouseY = useMotionValue(-200);
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);

  function onMove(e: React.MouseEvent) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    mouseX.set(x);
    mouseY.set(y);
    const px = (x / r.width) - 0.5;
    const py = (y / r.height) - 0.5;
    rotateY.set(px * 8);
    rotateX.set(-py * 8);
  }

  function onLeave() {
    mouseX.set(-200);
    mouseY.set(-200);
    rotateX.set(0);
    rotateY.set(0);
  }

  const glare = useMotionTemplate`radial-gradient(280px circle at ${mouseX}px ${mouseY}px, rgba(16,185,129,0.18), transparent 70%)`;
  const border = useMotionTemplate`radial-gradient(420px circle at ${mouseX}px ${mouseY}px, rgba(52,211,153,0.55), rgba(148,163,184,0.08) 60%)`;

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      className={`group relative isolate overflow-hidden rounded-2xl ${className}`}
    >
      {/* Animated border layer */}
      <motion.div
        aria-hidden
        style={{ background: border }}
        className="pointer-events-none absolute inset-0 rounded-2xl p-px [mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude]"
      />
      {/* Inner card */}
      <div className="relative h-full rounded-2xl bg-slate-900/60 backdrop-blur-xl border border-white/10">
        {children}
        {/* Glare overlay */}
        <motion.div
          aria-hidden
          style={{ background: glare }}
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
      </div>
    </motion.div>
  );
}
