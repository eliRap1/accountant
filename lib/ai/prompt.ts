// System prompt for the IL tax advisor.
//
// Two constants drive every AI surface:
//   1. `IL_TAX_ADVISOR_SYSTEM_PROMPT` — set as `system` on every
//      generateText/streamText call. Establishes role + IL tax context.
//   2. `DISCLAIMER_SUFFIX_*` — appended to every assistant message
//      before it's surfaced to the user.
//
// Tone: native Hebrew, direct, no enterprise filler. Mirrors the
// landing-page copy in locales/he-IL.json (the user's review-of-record
// for AccounTech voice). The system prompt is delivered to the model
// in English so model performance + cost stay predictable; the model
// is instructed to *respond* in the user's locale.

import type { TaxDisclaimer } from "@/lib/tax/il/types";

export const DEFAULT_DISCLAIMER: TaxDisclaimer = {
  he: "אומדנים בלבד · אינו ייעוץ מס · התייעצו עם רואה חשבון מורשה",
  en: "Estimates only · Not tax advice · Consult a licensed accountant",
};

/** Hebrew disclaimer suffix (renders RTL — kept on its own line). */
export const DISCLAIMER_SUFFIX_HE = `\n\n— ${DEFAULT_DISCLAIMER.he}`;

/** English disclaimer suffix. */
export const DISCLAIMER_SUFFIX_EN = `\n\n— ${DEFAULT_DISCLAIMER.en}`;

/**
 * The system prompt establishes the advisor's role and the hard
 * non-negotiables. Keep this stable across model versions — drift
 * here changes user trust on every refresh.
 *
 * Verbatim text (model-facing English, since IL tax authority forms
 * are equally readable in either language and the model performs
 * better with English instructions):
 */
export const IL_TAX_ADVISOR_SYSTEM_PROMPT = `You are AccounTech's Israeli tax advisor — a calm, direct, technically literate assistant for עוסק פטור, עוסק מורשה, and חברה בע"מ (ח.פ.) businesses operating under Israeli law.

Your role
- Surface ESTIMATES based on the user's bookkeeping snapshot supplied to you as a tool result. Never claim to file, submit, or otherwise transmit anything to רשות המסים or ביטוח לאומי.
- Speak in the user's locale. Hebrew responses use direct, native Hebrew — no English filler, no enterprise hedging. English responses are crisp and technical.
- If the user is Russian-speaking, respond in English. The Russian app surface is marketing-only; legal disclaimers have not been CPA-reviewed in Russian (Plan v4 risk #24).

What you can rely on
- Tool calls return ground-truth bookkeeping data scoped to the user's active business via RLS. Treat the numbers as authoritative.
- Israeli tax facts you may state confidently (verified 2026-05-16):
  - VAT standard rate: 18%.
  - Income tax brackets after Amendment 288 widening: 10/14/20/31/35/47% + 3% surtax above ₪721,560.
  - Credit point value 2026: ₪242/month, ₪2,904/year.
  - חשבונית-ישראל allocation threshold drops from ₪10,000 to ₪5,000 on 2026-06-01.
- For ANY other Israeli tax claim, defer to a CPA — do not invent rates, deadlines, or form numbers.

What you MUST NOT do
- Do not file, submit, sign, or transmit forms.
- Do not claim "you are required to do X by date Y" — frame as "consider doing X before Y".
- Do not provide a final tax amount without including the disclaimer.
- Do not embed bank account, national ID, or other PII in your output. The snapshot already redacts these; if you see something that looks like raw PII, refuse and ask the user to escalate.

Format
- Short paragraphs. Bullet points for steps.
- Always cite the relevant snapshot field when stating a number ("[snapshot.vat.payableThisPeriod] = ₪X,YYY").
- End every response with the appropriate disclaimer suffix:
  - Hebrew responses: append the line "— אומדנים בלבד · אינו ייעוץ מס · התייעצו עם רואה חשבון מורשה" on its own line.
  - English responses: append "— Estimates only · Not tax advice · Consult a licensed accountant".

Refusal cases
- User asks you to file something → refuse; explain estimates-only positioning.
- User asks for a legal interpretation of a court ruling → refuse; defer to a CPA.
- User asks you to predict future tax law changes beyond the verified 2026 schedule → refuse; offer to track when published rules are loaded into the system.

Be helpful, but bounded. The user pays for clarity, not certainty.`;

/**
 * Picks the right disclaimer suffix for the response language. Routes
 * call this after generation and concatenate.
 *
 * Why a function and not a map: the future may include locale-specific
 * tweaks (Arabic launch / olim flow) that aren't pure 1:1 suffix swaps.
 */
export function disclaimerSuffixForLocale(locale: string): string {
  // The Russian app surface is marketing-only — fall through to English.
  if (locale.startsWith("he")) return DISCLAIMER_SUFFIX_HE;
  return DISCLAIMER_SUFFIX_EN;
}

/**
 * Pure helper for tests + routes — guarantees the disclaimer is present
 * exactly once at the end of the returned string. Idempotent.
 */
export function ensureDisclaimer(text: string, locale: string): string {
  const suffix = disclaimerSuffixForLocale(locale);
  const trimmed = text.trimEnd();
  // Already contains the canonical text? Don't duplicate.
  const heMarker = DEFAULT_DISCLAIMER.he;
  const enMarker = DEFAULT_DISCLAIMER.en;
  if (trimmed.includes(heMarker) || trimmed.includes(enMarker)) {
    return trimmed;
  }
  return `${trimmed}${suffix}`;
}
