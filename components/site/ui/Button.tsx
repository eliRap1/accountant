"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { forwardRef } from "react";

type Variant = "primary" | "ghost" | "outline";

type Props = Omit<HTMLMotionProps<"button">, "ref" | "children"> & {
  variant?: Variant;
  withArrow?: boolean;
  as?: "button" | "a";
  href?: string;
  children?: React.ReactNode;
};

const styles: Record<Variant, string> = {
  primary:
    "bg-emerald-500 text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] hover:bg-emerald-400 hover:shadow-[0_14px_50px_-8px_rgba(16,185,129,0.85)]",
  ghost:
    "bg-white/5 text-slate-100 border border-white/10 hover:bg-white/10",
  outline:
    "bg-transparent text-emerald-300 border border-emerald-400/50 hover:bg-emerald-500/10",
};

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", withArrow, className = "", children, ...rest },
  ref
) {
  return (
    <motion.button
      ref={ref}
      whileHover={{ scale: 1.035, y: -1 }}
      whileTap={{ scale: 0.97, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 22 }}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium tracking-tight transition-colors will-change-transform ${styles[variant]} ${className}`}
      {...rest}
    >
      <span>{children}</span>
      {withArrow && (
        <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0" />
      )}
    </motion.button>
  );
});

export default Button;
