import { redirect } from "next/navigation";
import type { Route } from "next";
import { setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import OnboardingWizard from "./OnboardingWizard";
import { routing } from "@/i18n/routing";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { getOnboardingState } from "@/lib/aggregations/onboardingState";

export const metadata = {
  title: "Onboarding · AccounTech",
};

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);

  const user = await requireCurrentUser();
  // If the user already has a business, the onboarding flow is "done"
  // for the profile step. Bounce them onto the dashboard so they don't
  // re-create another business by accident.
  const state = await getOnboardingState(user.appUserId);
  if (state.hasBusiness) {
    redirect(`/${locale}/dashboard` as Route);
  }

  return (
    <div className="mx-auto w-full max-w-2xl py-6">
      <OnboardingWizard locale={locale} />
    </div>
  );
}
