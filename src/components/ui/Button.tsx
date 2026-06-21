"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { forwardRef } from "react";

type Variant = "primary" | "ghost" | "outline";

// Base shared props (non-element-specific)
type BaseProps = {
  variant?: Variant;
  withArrow?: boolean;
  children?: React.ReactNode;
  className?: string;
};

// When rendered as an anchor element
type AnchorProps = BaseProps &
  Omit<HTMLMotionProps<"a">, "ref" | "children" | "className"> & {
    as: "a";
    href: string;
  };

// When rendered as a button element (default)
type ButtonProps = BaseProps &
  Omit<HTMLMotionProps<"button">, "ref" | "children" | "className"> & {
    as?: "button";
    href?: never;
  };

type Props = AnchorProps | ButtonProps;

const styles: Record<Variant, string> = {
  primary:
    "bg-emerald-500 text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] hover:bg-emerald-400 hover:shadow-[0_14px_50px_-8px_rgba(16,185,129,0.85)]",
  ghost:
    "bg-white/5 text-slate-100 border border-white/10 hover:bg-white/10",
  outline:
    "bg-transparent text-emerald-300 border border-emerald-400/50 hover:bg-emerald-500/10",
};

const sharedMotion = {
  whileHover: { scale: 1.035, y: -1 },
  whileTap: { scale: 0.97, y: 0 },
  transition: { type: "spring" as const, stiffness: 380, damping: 22 },
};

const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, Props>(
  function Button(
    { variant = "primary", withArrow, className = "", children, as, ...rest },
    ref
  ) {
    const baseClass = `inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium tracking-tight transition-colors will-change-transform ${styles[variant]} ${className}`;
    const inner = (
      <>
        <span>{children}</span>
        {withArrow && (
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        )}
      </>
    );

    if (as === "a") {
      const { href, ...anchorRest } = rest as Omit<AnchorProps, "as" | "variant" | "withArrow" | "children" | "className">;
      return (
        <motion.a
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          {...sharedMotion}
          className={baseClass}
          {...anchorRest}
        >
          {inner}
        </motion.a>
      );
    }

    return (
      <motion.button
        ref={ref as React.Ref<HTMLButtonElement>}
        {...sharedMotion}
        className={baseClass}
        {...(rest as Omit<ButtonProps, "as" | "variant" | "withArrow" | "children" | "className">)}
      >
        {inner}
      </motion.button>
    );
  }
);

export default Button;
