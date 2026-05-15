import { Link } from "@/i18n/navigation";

// Auth route group — sign-in, sign-up, verify-email, etc. The wrapper
// no longer hard-codes Hebrew chrome: the parent `[locale]/layout.tsx`
// already sets `<html lang dir>` based on the URL segment, so this
// component just provides the glass-strong card scaffolding.
//
// Russian is rewritten to en-US by `proxy.ts` (Plan v4 Risk #24 — no
// CPA-reviewed Russian disclaimer surface yet), so when a user is on
// /ru-RU/sign-in they see the URL stay on /ru-RU but the body renders
// the English layout below.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-12 overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-50 pointer-events-none" />
      <Link
        href="/"
        className="group mb-10 flex items-center gap-2.5"
        aria-label="AccounTech"
      >
        <svg
          width="34"
          height="34"
          viewBox="0 0 40 40"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="acg-auth" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
          </defs>
          <polygon
            points="20,2 36,11 36,29 20,38 4,29 4,11"
            fill="none"
            stroke="url(#acg-auth)"
            strokeWidth="1.5"
          />
          <rect x="13" y="14" width="14" height="2.4" rx="1" fill="url(#acg-auth)" />
          <rect x="13" y="19" width="10" height="2.4" rx="1" fill="#10b981" opacity="0.85" />
          <rect x="13" y="24" width="14" height="2.4" rx="1" fill="url(#acg-auth)" />
        </svg>
        <div className="leading-none" dir="ltr">
          <span className="block text-[15px] font-semibold tracking-tight text-slate-100 group-hover:text-white transition-colors">
            Accoun<span className="text-emerald-400">Tech</span>
          </span>
          <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-slate-500">
            דיוק ושקיפות
          </span>
        </div>
      </Link>
      <main className="w-full max-w-md relative">{children}</main>
    </div>
  );
}
