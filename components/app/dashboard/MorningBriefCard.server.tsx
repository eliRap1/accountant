import { getLatestMorningBrief } from "@/lib/notifications/morningBriefNotifications";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import MorningBriefCard from "./MorningBriefCard";

// Server wrapper: fetches the latest morning_brief notification for the
// active user via withUser (RLS-scoped), formats the generated-at label,
// and hands data + locale to the client card.
//
// The dashboard page renders this above its existing KPI tiles. If the
// user has no brief yet (first day, or no business), the client card
// renders an empty-state nudge instead of crashing.

type Props = {
  locale: string;
};

export default async function MorningBriefCardServer({ locale }: Props) {
  const user = await requireCurrentUser();
  const latest = await getLatestMorningBrief(user.appUserId);

  const generatedAtLabel = latest ? formatGeneratedAt(latest.createdAt, locale) : null;

  return (
    <MorningBriefCard
      locale={locale}
      brief={latest?.payload ?? null}
      generatedAtLabel={generatedAtLabel}
    />
  );
}

/**
 * "08:14 בבוקר" / "08:14 AM". Uses native Intl for locale-aware time.
 * Falls back to a fixed format when Intl misbehaves.
 */
function formatGeneratedAt(createdAt: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(localeForIntl(locale), {
      hour: "2-digit",
      minute: "2-digit",
    }).format(createdAt);
  } catch {
    const hh = String(createdAt.getHours()).padStart(2, "0");
    const mm = String(createdAt.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
}

function localeForIntl(raw: string): string {
  if (raw.startsWith("he")) return "he-IL";
  if (raw.startsWith("ru")) return "en-US";
  return "en-US";
}
