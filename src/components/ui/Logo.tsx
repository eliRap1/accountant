"use client";

import { motion } from "framer-motion";
import { useId } from "react";

type Props = {
  className?: string;
  showWordmark?: boolean;
};

export default function Logo({ className = "", showWordmark = true }: Props) {
  const gradientId = useId();

  return (
    <a href="#top" className={`group flex items-center gap-2.5 ${className}`}>
      <motion.svg
        width="34"
        height="34"
        viewBox="0 0 40 40"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="AccounTech logo"
        initial={{ rotate: -10, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
        {/* Outer hex */}
        <motion.polygon
          points="20,2 36,11 36,29 20,38 4,29 4,11"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="1.5"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: "easeInOut" }}
        />
        {/* Inner stacked bars (ledger glyph) */}
        <rect x="13" y="14" width="14" height="2.4" rx="1" fill={`url(#${gradientId})`} />
        <rect x="13" y="19" width="10" height="2.4" rx="1" fill="#10b981" opacity="0.85" />
        <rect x="13" y="24" width="14" height="2.4" rx="1" fill={`url(#${gradientId})`} />
        {/* Diagonal accent (rising trend) */}
        <motion.path
          d="M9 30 L31 12"
          stroke="#ecfdf5"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.5"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.4, delay: 0.4 }}
        />
      </motion.svg>
      {showWordmark && (
        <div className="leading-none">
          <span className="block text-[15px] font-semibold tracking-tight text-slate-100 group-hover:text-white transition-colors">
            Accoun<span className="text-emerald-400">Tech</span>
          </span>
          <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Precision · Transparency
          </span>
        </div>
      )}
    </a>
  );
}
