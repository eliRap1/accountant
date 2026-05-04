"use client";

import Logo from "../ui/Logo";

const Twitter = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="currentColor" className={p.className} aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231L18.244 2.25Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z"/>
  </svg>
);

const Linkedin = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="currentColor" className={p.className} aria-hidden>
    <path d="M20.451 20.452h-3.554v-5.569c0-1.328-.027-3.038-1.852-3.038-1.853 0-2.136 1.446-2.136 2.94v5.667H9.355V9h3.414v1.561h.046c.477-.9 1.637-1.852 3.37-1.852 3.602 0 4.267 2.37 4.267 5.455v6.288zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.114 20.452H3.558V9h3.556v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

const Github = (p: { size?: number; className?: string }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="currentColor" className={p.className} aria-hidden>
    <path d="M12 .297a12 12 0 0 0-3.79 23.387c.6.111.82-.261.82-.577 0-.285-.011-1.04-.016-2.04-3.338.726-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.776.418-1.305.762-1.605-2.665-.305-5.466-1.334-5.466-5.93 0-1.31.467-2.382 1.236-3.222-.124-.303-.535-1.524.117-3.176 0 0 1.008-.323 3.301 1.23a11.51 11.51 0 0 1 6.003 0c2.292-1.553 3.298-1.23 3.298-1.23.654 1.652.243 2.873.12 3.176.77.84 1.234 1.912 1.234 3.222 0 4.61-2.804 5.62-5.475 5.92.43.37.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .319.218.694.825.576A12 12 0 0 0 12 .297"/>
  </svg>
);

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative mx-auto mt-20 w-full max-w-7xl px-6 pb-12">
      <div className="rounded-3xl border border-white/5 bg-slate-950/50 p-10 backdrop-blur-xl">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              AccounTech — modern accounting, audit, and tax. Built for companies that
              measure twice and ship once.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <Column
              title="Practice"
              links={["Audit & Assurance", "Tax", "Consulting", "Forensics"]}
            />
            <Column title="Company" links={["About", "Careers", "Press", "Contact"]} />
            <Column title="Resources" links={["Insights", "Case Studies", "Compliance", "Trust"]} />
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-white/5 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
          <span>
            © {year} AccounTech LLP · A registered CPA firm. All rights reserved.
          </span>
          <div className="flex items-center gap-3">
            <a className="rounded-lg p-2 hover:bg-white/5 hover:text-slate-200" aria-label="Twitter" href="#">
              <Twitter size={15} />
            </a>
            <a className="rounded-lg p-2 hover:bg-white/5 hover:text-slate-200" aria-label="LinkedIn" href="#">
              <Linkedin size={15} />
            </a>
            <a className="rounded-lg p-2 hover:bg-white/5 hover:text-slate-200" aria-label="GitHub" href="#">
              <Github size={15} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function Column({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h4 className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
        {title}
      </h4>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l}>
            <a href="#" className="text-sm text-slate-300 transition-colors hover:text-emerald-300">
              {l}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
