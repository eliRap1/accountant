"use client";

import { motion } from "framer-motion";
import Button from "../ui/Button";
import { Mail, Phone, MapPin } from "lucide-react";
import { useT } from "../i18n/LanguageProvider";

export default function CTA() {
  const t = useT();

  return (
    <section id="contact" className="relative mx-auto w-full max-w-7xl px-6 py-32">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 p-10 sm:p-16"
      >
        <div className="pointer-events-none absolute -start-24 top-1/2 h-96 w-96 -translate-y-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -end-24 -bottom-24 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />

        <div className="relative grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="text-xs uppercase tracking-[0.22em] text-emerald-400">
              {t.cta.eyebrow}
            </span>
            <h2 className="mt-3 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl md:text-6xl">
              {t.cta.title1} <br /> {t.cta.title2}
            </h2>
            <p className="mt-5 max-w-md text-slate-400">{t.cta.desc}</p>

            <ul className="mt-8 space-y-3 text-sm text-slate-300">
              <li className="flex items-center gap-3">
                <Mail size={16} className="text-emerald-400" />
                <span dir="ltr">hello@accountech.example.com</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone size={16} className="text-emerald-400" />
                <span dir="ltr">+1 (212) 555-0142</span>
              </li>
              <li className="flex items-center gap-3">
                <MapPin size={16} className="text-emerald-400" />
                {t.cta.address}
              </li>
            </ul>
          </div>

          <form
            onSubmit={(e) => e.preventDefault()}
            className="glass-strong space-y-4 rounded-2xl p-6 sm:p-8"
          >
            <Field label={t.cta.nameLabel} type="text" placeholder={t.cta.namePh} />
            <Field label={t.cta.emailLabel} type="email" placeholder={t.cta.emailPh} />
            <Field label={t.cta.companyLabel} type="text" placeholder={t.cta.companyPh} />
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-[0.16em] text-slate-400">
                {t.cta.msgLabel}
              </label>
              <textarea
                rows={4}
                placeholder={t.cta.msgPh}
                className="w-full resize-none rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-400/60"
              />
            </div>
            <Button type="submit" variant="primary" withArrow className="w-full">
              {t.cta.submit}
            </Button>
            <p className="text-center text-[11px] text-slate-500">{t.cta.note}</p>
          </form>
        </div>
      </motion.div>
    </section>
  );
}

function Field({
  label,
  type,
  placeholder,
}: {
  label: string;
  type: string;
  placeholder: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs uppercase tracking-[0.16em] text-slate-400">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-400/60"
      />
    </div>
  );
}
