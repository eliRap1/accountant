import { redirect } from "next/navigation";
import type { Route } from "next";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth/serverSession";
import { routing } from "@/i18n/routing";

// Landing page after sign-in / email-verification / 2FA. Resolves the
// session, ensures the app users row exists, then routes the user to
// onboarding (first time) or dashboard (returning).
//
// For Phase A.3 Chunk 1 onboarding/dashboard don't exist yet — we route
// to the landing page of the user's preferred locale, falling back to
// the project default (he-IL).
export default async function PostAuthPage() {
  // Resolve the user's preferred locale from the next-intl cookie set by
  // the proxy/middleware on every request. Falls back to default.
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(
    typeof routing.localeCookie === "object" && routing.localeCookie.name
      ? routing.localeCookie.name
      : "NEXT_LOCALE",
  )?.value;
  const locale =
    cookieLocale && (routing.locales as readonly string[]).includes(cookieLocale)
      ? cookieLocale
      : routing.defaultLocale;

  const u = await currentUser();
  if (!u) {
    redirect(`/${locale}/sign-in` as Route);
  }
  // TODO(B): redirect to /onboarding if user has no business yet,
  // otherwise to /dashboard. Until then, send to localised landing.
  redirect(`/${locale}` as Route);
}
