"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import Button from "../ui/Button";
import { Mail, Phone, MapPin } from "lucide-react";

type FormStatus = "idle" | "loading" | "success" | "error";

export default function CTA() {
  const [fields, setFields] = useState({
    name: "",
    email: "",
    company: "",
    message: "",
  });
  const [status, setStatus] = useState<FormStatus>("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error("Request failed");
      setStatus("success");
      setFields({ name: "", email: "", company: "", message: "" });
    } catch {
      setStatus("error");
    }
  }

  return (
    <section id="contact" className="relative mx-auto w-full max-w-7xl px-6 py-32">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 p-10 sm:p-16"
      >
        {/* Glow */}
        <div className="pointer-events-none absolute -left-24 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />

        <div className="relative grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="text-xs uppercase tracking-[0.22em] text-emerald-400">
              Start the conversation
            </span>
            <h2 className="mt-3 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl md:text-6xl">
              Ready to upgrade <br /> your finance stack?
            </h2>
            <p className="mt-5 max-w-md text-slate-400">
              Book a 30-minute fit call. We&apos;ll walk through your current close, audit
              posture, and tax exposure—and tell you straight whether we&apos;re a match.
            </p>

            <ul className="mt-8 space-y-3 text-sm text-slate-300">
              <li className="flex items-center gap-3">
                <Mail size={16} className="text-emerald-400" />
                hello@accountech.example.com
              </li>
              <li className="flex items-center gap-3">
                <Phone size={16} className="text-emerald-400" />
                +1 (212) 555-0142
              </li>
              <li className="flex items-center gap-3">
                <MapPin size={16} className="text-emerald-400" />
                100 Vesey St, New York · Remote-first
              </li>
            </ul>
          </div>

          <form
            onSubmit={handleSubmit}
            className="glass-strong space-y-4 rounded-2xl p-6 sm:p-8"
          >
            {status === "success" ? (
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-6 text-center text-sm text-emerald-300">
                Thanks! We&apos;ll be in touch within one business day.
              </div>
            ) : (
              <>
                <Field
                  id="cta-name"
                  label="Full name"
                  type="text"
                  placeholder="Jane Doe"
                  value={fields.name}
                  onChange={(v) => setFields((f) => ({ ...f, name: v }))}
                />
                <Field
                  id="cta-email"
                  label="Work email"
                  type="email"
                  placeholder="jane@company.com"
                  value={fields.email}
                  onChange={(v) => setFields((f) => ({ ...f, email: v }))}
                />
                <Field
                  id="cta-company"
                  label="Company"
                  type="text"
                  placeholder="Acme, Inc."
                  value={fields.company}
                  onChange={(v) => setFields((f) => ({ ...f, company: v }))}
                />
                <div>
                  <label htmlFor="cta-message" className="mb-1.5 block text-xs uppercase tracking-[0.16em] text-slate-400">
                    What do you need help with?
                  </label>
                  <textarea
                    id="cta-message"
                    rows={4}
                    placeholder="Audit prep, R&D credit, monthly close..."
                    value={fields.message}
                    onChange={(e) => setFields((f) => ({ ...f, message: e.target.value }))}
                    className="w-full resize-none rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-400/60"
                  />
                </div>
                {status === "error" && (
                  <p className="text-xs text-red-400">Something went wrong. Please try again.</p>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  withArrow
                  className="w-full"
                  disabled={status === "loading"}
                >
                  {status === "loading" ? "Sending…" : "Request a call"}
                </Button>
                <p className="text-center text-[11px] text-slate-500">
                  We respond within one business day.
                </p>
              </>
            )}
          </form>
        </div>
      </motion.div>
    </section>
  );
}

function Field({
  id,
  label,
  type,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs uppercase tracking-[0.16em] text-slate-400">
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-400/60"
      />
    </div>
  );
}
