import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import AppShell from "@/components/app/AppShell";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import { routing } from "@/i18n/routing";
import { currentUser } from "@/lib/auth/serverSession";

// Authenticated-only route group. The (auth) tree is reachable
// anonymously; everything under (app) requires a Better Auth session.
// We resolve the session here in the layout so child server components
// can rely on it (and benefit from React `cache()` deduplication).
//
// The estimates-only disclaimer banner is rendered at the top of every
// (app) page — it's regulatory boilerplate (Plan v4 § Locked Decisions:
// "Disclaimer banner on every tax surface"). The wrapper lives in
// chunk C's territory; its server-component wrapper composes cleanly
// from this RSC layout without flipping into a client boundary.
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    // The parent [locale]/layout.tsx already 404s on unknown locales,
    // but TypeScript can't tell, so guard again before passing the
    // value to setRequestLocale.
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);

  const user = await currentUser();
  if (!user) {
    redirect(`/${locale}/sign-in` as Route);
  }

  return (
    <AppShell
      user={{
        email: user.email,
        name: user.name,
      }}
    >
      <div className="mx-auto mb-4 w-full max-w-7xl">
        <EstimatesDisclaimerBanner />
      </div>
      {children}
    </AppShell>
  );
}
