import { defineRouting } from "next-intl/routing";

// Centralised next-intl routing config. Locales are full IETF BCP-47 tags
// because Better Auth + Israeli regulator forms care about country
// distinction (he-IL vs he-only, en-US vs en-GB). The `[locale]` segment
// uses these strings verbatim in URLs (e.g. `/he-IL/sign-in`).
//
// Russian is *marketing-only* per Plan v4 — see Risk #24. The proxy
// rewrites any ru-RU app-route hits to en-US so users still get a
// CPA-reviewed disclaimer surface for sensitive operations.
export const routing = defineRouting({
  locales: ["he-IL", "en-US", "ru-RU"] as const,
  defaultLocale: "he-IL",
  localePrefix: "always",
  // The locale cookie is harmless on its own but we leave next-intl's
  // default behaviour in place — it remembers the user's last choice
  // when they land on the bare `/` and the proxy redirects.
  localeCookie: {
    name: "accountech.locale",
    sameSite: "lax",
  },
});

export type AppLocale = (typeof routing.locales)[number];
