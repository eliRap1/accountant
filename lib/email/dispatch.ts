// Type-safe locale dispatch table. App code MUST go through this module —
// never `import VerifyEmail from "@/lib/email/templates/he-IL/verify-email"`
// directly, or we'll send the wrong language when the locale changes.
//
// ru-RU intentionally falls through to en-US per Plan v4 Risk #24:
// Russian is *marketing-only*. Transactional emails for ru-RU users
// receive the en-US copy (still legally accurate) because there is no
// CPA-reviewed Russian disclaimer surface yet.
import type { AppLocale } from "@/i18n/routing";
import type { EmailTemplate } from "./templates/types";

import HeVerify from "./templates/he-IL/verify-email";
import HeReset from "./templates/he-IL/reset-password";
import HeMfa from "./templates/he-IL/mfa-enrolled";
import HeWelcome from "./templates/he-IL/welcome";
import HeMorningBrief from "./templates/he-IL/morning-brief";

import EnVerify from "./templates/en-US/verify-email";
import EnReset from "./templates/en-US/reset-password";
import EnMfa from "./templates/en-US/mfa-enrolled";
import EnWelcome from "./templates/en-US/welcome";
import EnMorningBrief from "./templates/en-US/morning-brief";

export type EmailKey =
  | "verifyEmail"
  | "resetPassword"
  | "mfaEnrolled"
  | "welcome"
  | "morningBrief";

const heIL: Record<EmailKey, EmailTemplate> = {
  verifyEmail: HeVerify,
  resetPassword: HeReset,
  mfaEnrolled: HeMfa,
  welcome: HeWelcome,
  morningBrief: HeMorningBrief,
};

const enUS: Record<EmailKey, EmailTemplate> = {
  verifyEmail: EnVerify,
  resetPassword: EnReset,
  mfaEnrolled: EnMfa,
  welcome: EnWelcome,
  morningBrief: EnMorningBrief,
};

export const byLocale: Record<AppLocale, Record<EmailKey, EmailTemplate>> = {
  "he-IL": heIL,
  "en-US": enUS,
  // ru-RU → English copy. Documented in module-level comment above.
  "ru-RU": enUS,
};

/**
 * Resolve a template by (locale, key). Returns the template object so the
 * caller can read `subject` / `text` and render `Component` directly. The
 * resolver is exhaustive at the type level — adding a new locale or
 * EmailKey forces a compile error here, which is the point.
 */
export function pickTemplate(locale: AppLocale, key: EmailKey): EmailTemplate {
  return byLocale[locale][key];
}

/**
 * Hot-substitution helper for plain-text fallbacks. Templates use `{url}`,
 * `{ip}`, `{ua}`, `{sentence}` as markers because string concatenation
 * inside a multiline array is fragile. Unknown markers are left in place
 * so a missing var shows up loudly in QA rather than silently disappearing.
 *
 * `{sentence}` is used by the Morning Tax Brief template — the route
 * handler builds the dynamic sentence via lib/ai/morningBriefSentence.ts
 * and passes it here.
 */
export function fillText(
  text: string,
  vars: {
    url?: string;
    ip?: string | null;
    ua?: string | null;
    sentence?: string;
  },
): string {
  return text
    .replaceAll("{url}", vars.url ?? "")
    .replaceAll("{ip}", vars.ip ?? "—")
    .replaceAll("{ua}", vars.ua ?? "—")
    .replaceAll("{sentence}", vars.sentence ?? "");
}
