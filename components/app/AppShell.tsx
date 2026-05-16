"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  UserCircle,
  Wallet,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import LanguageSwitcher from "@/components/site/ui/LanguageSwitcher";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { signOut } from "@/lib/auth/client";

// Authenticated app chrome. Hosts every (app) route — sidebar nav,
// header (locale switcher + user menu), and a fluid main panel.
//
// RTL is handled with logical properties (`start-`/`end-`, `inset-`)
// so the sidebar attaches to the start side regardless of locale.
//
// Email is passed in by the server layout (rather than fetched in the
// client) so the avatar initials render synchronously on first paint
// — keeps the sign-out menu from popping in late.

type UserShell = {
  email: string;
  name: string | null;
};

type NavKey =
  | "dashboard"
  | "businesses"
  | "clients"
  | "transactions"
  | "ledger"
  | "invoices"
  | "receipts"
  | "settings";

type NavItem = {
  key: NavKey;
  href: string;
  icon: typeof LayoutDashboard;
};

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "businesses", href: "/businesses", icon: ShieldCheck },
  { key: "clients", href: "/clients", icon: Users },
  { key: "transactions", href: "/transactions", icon: WalletCards },
  { key: "ledger", href: "/ledger", icon: Wallet },
  { key: "invoices", href: "/invoices", icon: FileText },
  { key: "receipts", href: "/receipts", icon: Receipt },
  { key: "settings", href: "/settings", icon: Settings },
];

function initialsFor(email: string, name: string | null): string {
  const cleaned = (name ?? email).trim();
  if (!cleaned) return "??";
  const parts = cleaned.split(/[\s@.]/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

export default function AppShell({
  user,
  children,
}: {
  user: UserShell;
  children: React.ReactNode;
}) {
  const t = useTranslations("app.shell");
  const locale = useLocale();
  const isRtl = locale === "he-IL";
  const pathname = usePathname();
  const router = useRouter();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close pop-ups when the URL changes (sidebar nav on mobile, user menu
  // after picking an item).
  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // Swallow — sign-out failures are rare and we still want to nav.
    }
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen w-full">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />

      <Sidebar
        navItems={NAV_ITEMS}
        currentPath={pathname}
        labels={(key) => t(`nav.${key}` as const)}
        isRtl={isRtl}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-white/5 bg-slate-950/70 px-4 py-3 backdrop-blur-md sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-white/5 lg:hidden"
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="flex flex-1" aria-hidden />

          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />

            <div ref={userMenuRef} className="relative">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10"
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-200"
                  dir="ltr"
                >
                  {initialsFor(user.email, user.name)}
                </span>
                <ChevronDown size={14} className="text-slate-400" />
              </motion.button>

              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="glass-strong absolute end-0 mt-2 min-w-[220px] overflow-hidden rounded-xl p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6)]"
                  >
                    <div
                      className="border-b border-white/5 px-3 py-2 text-xs text-slate-400"
                      dir="ltr"
                    >
                      {user.email}
                    </div>
                    <Link
                      href="/settings"
                      role="menuitem"
                      className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/5"
                    >
                      <UserCircle size={14} className="text-emerald-300" />
                      {t("user.account")}
                    </Link>
                    <Link
                      href="/settings"
                      role="menuitem"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/5"
                    >
                      <Settings size={14} className="text-emerald-300" />
                      {t("user.settings")}
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={onSignOut}
                      disabled={signingOut}
                      className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-red-500/10 hover:text-red-200 disabled:opacity-60"
                    >
                      <LogOut size={14} />
                      {t("user.signOut")}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="relative z-10 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  navItems,
  currentPath,
  labels,
  isRtl,
  mobileOpen,
  onCloseMobile,
}: {
  navItems: NavItem[];
  currentPath: string;
  labels: (key: NavKey) => string;
  isRtl: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCloseMobile}
            className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm lg:hidden"
            aria-hidden
          />
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={{
          x: mobileOpen ? 0 : isRtl ? "100%" : "-100%",
        }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className={`glass-strong fixed top-0 z-40 flex h-screen w-64 flex-col gap-1 border-white/5 px-3 py-5 lg:static lg:translate-x-0 lg:border-${isRtl ? "l" : "r"} ${
          isRtl ? "end-0 border-l" : "start-0 border-r"
        }`}
        style={{ pointerEvents: mobileOpen ? "auto" : undefined }}
      >
        <div className="mb-4 flex items-center gap-2.5 px-2 pt-1">
          <svg
            width="28"
            height="28"
            viewBox="0 0 40 40"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient
                id="acg-app-shell"
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
            </defs>
            <polygon
              points="20,2 36,11 36,29 20,38 4,29 4,11"
              fill="none"
              stroke="url(#acg-app-shell)"
              strokeWidth="1.5"
            />
            <rect
              x="13"
              y="14"
              width="14"
              height="2.4"
              rx="1"
              fill="url(#acg-app-shell)"
            />
            <rect
              x="13"
              y="19"
              width="10"
              height="2.4"
              rx="1"
              fill="#10b981"
              opacity="0.85"
            />
            <rect
              x="13"
              y="24"
              width="14"
              height="2.4"
              rx="1"
              fill="url(#acg-app-shell)"
            />
          </svg>
          <div className="leading-none" dir="ltr">
            <span className="block text-sm font-semibold tracking-tight text-slate-100">
              Accoun<span className="text-emerald-400">Tech</span>
            </span>
            <span className="mt-0.5 block text-[9px] uppercase tracking-[0.16em] text-slate-500">
              app
            </span>
          </div>
        </div>

        <nav className="mt-2 flex flex-col gap-0.5" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              currentPath === item.href ||
              (item.href !== "/dashboard" &&
                currentPath.startsWith(item.href));
            return (
              <SidebarLink
                key={item.key}
                href={item.href}
                label={labels(item.key)}
                Icon={Icon}
                active={active}
                isRtl={isRtl}
              />
            );
          })}
        </nav>
      </motion.aside>
    </>
  );
}

function SidebarLink({
  href,
  label,
  Icon,
  active,
  isRtl,
}: {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  active: boolean;
  isRtl: boolean;
}) {
  return (
    <Link
      // The nav targets live in `app/[locale]/(app)/...` — the i18n Link
      // accepts a plain string and auto-prefixes the active locale. We
      // cast to `any` here because `typedRoutes` doesn't know about the
      // sibling chunks' pages yet — once chunk B lands its routes the
      // explicit cast can be removed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      href={href as any}
      className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-gradient-to-r from-emerald-500/20 to-emerald-500/5 text-emerald-100"
          : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      {active && (
        <motion.span
          layoutId="appShellActiveBar"
          aria-hidden
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className={`absolute top-1.5 bottom-1.5 w-[3px] rounded-full bg-emerald-400 ${
            isRtl ? "end-0" : "start-0"
          }`}
        />
      )}
      <Icon
        size={15}
        className={active ? "text-emerald-300" : "text-slate-400"}
      />
      <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}
