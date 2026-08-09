"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import { TrendingUp, Activity, PieChart, ArrowUpRight } from "lucide-react";

type Row = { month: string; revenue: number; ebitda: number };

const data: Row[] = [
  { month: "Jan", revenue: 142, ebitda: 28 },
  { month: "Feb", revenue: 168, ebitda: 36 },
  { month: "Mar", revenue: 154, ebitda: 33 },
  { month: "Apr", revenue: 201, ebitda: 48 },
  { month: "May", revenue: 232, ebitda: 59 },
  { month: "Jun", revenue: 248, ebitda: 67 },
  { month: "Jul", revenue: 276, ebitda: 78 },
  { month: "Aug", revenue: 311, ebitda: 92 },
  { month: "Sep", revenue: 342, ebitda: 104 },
  { month: "Oct", revenue: 389, ebitda: 121 },
  { month: "Nov", revenue: 412, ebitda: 134 },
  { month: "Dec", revenue: 458, ebitda: 152 },
];

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; payload: Row }>; label?: string }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="glass-strong rounded-xl px-3.5 py-2.5 text-xs">
      <div className="mb-1 text-slate-400">{label} 2026</div>
      <div className="flex items-center gap-2 text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Revenue: <span className="text-slate-100 font-semibold">${row.revenue}k</span>
      </div>
      <div className="flex items-center gap-2 text-slate-300">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        EBITDA: <span className="text-slate-100 font-semibold">${row.ebitda}k</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const parallax = useTransform(scrollYProgress, [0, 1], [40, -40]);

  const [hovered, setHovered] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const total = data.reduce((acc, d) => acc + d.revenue, 0);
  const yoy = ((data[11].revenue - data[0].revenue) / data[0].revenue) * 100;

  return (
    <section
      ref={ref}
      id="dashboard"
      className="relative mx-auto w-full max-w-7xl px-6 py-32"
    >
      <motion.div style={{ y: parallax }} className="mb-12 flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between">
        <div className="max-w-xl">
          <span className="text-xs uppercase tracking-[0.22em] text-emerald-400">
            Live Preview
          </span>
          <h2 className="mt-3 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl md:text-6xl">
            Your finances,{" "}
            <span className="text-gradient">in motion.</span>
          </h2>
          <p className="mt-4 text-slate-400">
            Hover the bars to inspect monthly performance. Every figure flows from the
            same general ledger that powers your filings.
          </p>
        </div>
        <a
          href="#contact"
          className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-slate-200 hover:text-white transition-colors"
        >
          See full demo <ArrowUpRight size={15} />
        </a>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 60 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="glass-strong relative overflow-hidden rounded-3xl p-6 sm:p-8"
      >
        {/* Decorative glow */}
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

        {/* KPI row */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Kpi icon={TrendingUp} label="ARR Run-rate" value={`$${(data[11].revenue * 12 / 1000).toFixed(1)}M`} delta={`+${yoy.toFixed(1)}%`} />
          <Kpi icon={Activity} label="Gross Margin" value="74.2%" delta="+3.1 pts" />
          <Kpi icon={PieChart} label="EBITDA TTM" value={`$${data.reduce((a, d) => a + d.ebitda, 0)}k`} delta="+62%" />
          <Kpi icon={TrendingUp} label="FY Growth (Jan→Dec)" value={`${yoy.toFixed(0)}%`} delta="strong" subtle />
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          {/* Bar chart */}
          <div className="rounded-2xl border border-white/5 bg-slate-950/50 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-200">Monthly Revenue</h3>
              <span className="text-xs text-slate-500">FY 2026 · ${(total / 1000).toFixed(2)}M</span>
            </div>
            <div className="h-72">
              {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  onMouseMove={(s) => setHovered(typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : null)}
                  onMouseLeave={() => setHovered(null)}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient id="barFillDim" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.18} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} stroke="#64748b" fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} stroke="#64748b" fontSize={11} />
                  <Tooltip cursor={{ fill: "rgba(16,185,129,0.06)" }} content={<CustomTooltip />} />
                  <Bar dataKey="revenue" radius={[6, 6, 2, 2]} animationDuration={1100}>
                    {data.map((_, i) => (
                      <Cell
                        key={i}
                        fill={
                          hovered === null || hovered === i ? "url(#barFill)" : "url(#barFillDim)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Side area chart */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/5 bg-slate-950/50 p-4 sm:p-5">
              <h3 className="mb-2 text-sm font-medium text-slate-200">EBITDA Trajectory</h3>
              <div className="h-44">
                {mounted && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="ebitda"
                      stroke="#34d399"
                      strokeWidth={2}
                      fill="url(#areaFill)"
                      animationDuration={1300}
                    />
                    <XAxis dataKey="month" hide />
                    <YAxis hide />
                  </AreaChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-slate-950/50 p-5">
              <h3 className="mb-3 text-sm font-medium text-slate-200">Cash Position</h3>
              <ul className="space-y-3">
                {[
                  { label: "Operating", pct: 64, value: "$2.1M" },
                  { label: "Reserve", pct: 22, value: "$720k" },
                  { label: "Investment", pct: 14, value: "$460k" },
                ].map((r) => (
                  <li key={r.label} className="text-xs">
                    <div className="mb-1 flex justify-between text-slate-400">
                      <span>{r.label}</span>
                      <span className="text-slate-200">{r.value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${r.pct}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  delta,
  subtle,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  delta: string;
  subtle?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="rounded-2xl border border-white/5 bg-slate-950/50 p-4"
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
        <Icon size={13} className="text-emerald-400" />
        {label}
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-2xl font-semibold tracking-tight text-slate-50">{value}</span>
        <span className={`text-xs font-medium ${subtle ? "text-slate-400" : "text-emerald-300"}`}>
          {delta}
        </span>
      </div>
    </motion.div>
  );
}
