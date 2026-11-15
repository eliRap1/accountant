// Morning Tax Brief — plain-Hebrew sentence renderer.
//
// Pure function. Given the structured brief payload + locale, returns the
// natural-language sentence(s) that ship in the email + dashboard card.
//
// Tone: native Hebrew, direct, no enterprise filler. Mirrors the AI
// advisor's voice (lib/ai/prompt.ts) so users don't feel two different
// products. English fallback is crisp and technical.
//
// Action-next states (priority order — caller picks via composeMorningBrief):
//   1. pay_vat            — VAT due ≤ 7d AND cash shortfall
//   2. follow_up_overdue  — overdue invoices ≥ 7d old
//   3. categorise_receipts — pending receipts (and unblocking them lowers VAT)
//   4. pay_vat (fallback) — VAT due ≤ 7d but cash covers it
//   5. nothing_urgent     — quiet morning
//
// Output ALWAYS includes the canonical disclaimer suffix the rest of the
// tax surface uses. ensureDisclaimer() is idempotent so the caller can
// trust the result is shippable as-is.

import type { TaxDisclaimer } from "@/lib/tax/il/types";
import {
  disclaimerSuffixForLocale,
  ensureDisclaimer,
} from "@/lib/ai/prompt";

export type MorningBriefAction =
  | "pay_vat"
  | "categorise_receipts"
  | "follow_up_overdue"
  | "nothing_urgent";

export type MorningBriefSentenceInput = {
  /** ISO language tag — "he-IL" | "en-US" | "ru-RU". ru falls through to en. */
  locale: string;
  /** Action the brief is centred on. Picks the sentence template. */
  action: MorningBriefAction;
  /** Recipient first name (best-effort — may be undefined). */
  userName?: string | null;
  /** VAT owed for the current period in MINOR units (agorot). */
  vatDueMinor: bigint;
  /** Filing/payment deadline. */
  vatDueDate: Date;
  /** "כסף בבנק" — sum of operating cash across financial accounts. */
  cashOnHandMinor: bigint;
  /** Cash shortfall (vatDueMinor − cashOnHandMinor) clamped at 0. */
  cashGapMinor: bigint;
  /** Count of receipts awaiting categorisation (pending_review). */
  pendingReceiptCount: number;
  /** Oldest pending receipt: vendor (PII-light) + amount, used in template 3. */
  oldestPendingReceipt: {
    vendor: string | null;
    amountMinor: bigint;
  } | null;
  /** Number of invoices > 7d overdue. */
  overdueInvoiceCount: number;
  /** Sum of all overdue invoice totals (minor units). */
  overdueInvoiceTotalMinor: bigint;
  /**
   * Optional "what-if" hint for template 3 — projected VAT if the oldest
   * pending receipt were categorised as a deductible. If absent the
   * sentence omits the hint. Currently always omitted (no AI call);
   * kept on the type for the next pass when we wire categorisation.
   */
  vatIfCategorisedMinor?: bigint | null;
};

/**
 * Render the Morning Tax Brief sentence. Pure — no DB, no IO.
 *
 * Returns a single string. Always disclaimer-suffixed. Always non-empty.
 *
 * Hebrew sentence shape is designed to FIT a push notification (< 180
 * chars before disclaimer) AND read naturally in the in-app card.
 * Email subject + preheader use the same data via helpers below.
 */
export function renderMorningBriefSentence(
  input: MorningBriefSentenceInput,
): string {
  const isHe = input.locale.startsWith("he");

  // Russian falls through to English per Plan v4 Risk #24.
  const body = isHe ? renderHe(input) : renderEn(input);

  return ensureDisclaimer(body, isHe ? "he-IL" : "en-US");
}

/**
 * Email subject line (no disclaimer suffix — subject lines stay clean).
 * The body of the email carries the disclaimer.
 */
export function renderMorningBriefSubject(input: MorningBriefSentenceInput): string {
  const isHe = input.locale.startsWith("he");
  if (isHe) {
    switch (input.action) {
      case "pay_vat":
        return `סיכום בוקר · מע״מ ${shilling(input.vatDueMinor)} ל-${shortDate(input.vatDueDate, "he")}`;
      case "follow_up_overdue":
        return `סיכום בוקר · ${input.overdueInvoiceCount} חשבוניות פתוחות`;
      case "categorise_receipts":
        return `סיכום בוקר · ${input.pendingReceiptCount} קבלות לקיטלוג`;
      case "nothing_urgent":
        return "סיכום בוקר · הכל מסודר";
      default:
        return "סיכום בוקר";
    }
  }
  switch (input.action) {
    case "pay_vat":
      return `Morning brief · ${shilling(input.vatDueMinor)} VAT by ${shortDate(input.vatDueDate, "en")}`;
    case "follow_up_overdue":
      return `Morning brief · ${input.overdueInvoiceCount} overdue invoices`;
    case "categorise_receipts":
      return `Morning brief · ${input.pendingReceiptCount} receipts to categorise`;
    case "nothing_urgent":
      return "Morning brief · all clear";
    default:
      return "Morning brief";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────

function renderHe(i: MorningBriefSentenceInput): string {
  const greeting = i.userName ? `בוקר טוב ${i.userName}.` : "בוקר טוב.";
  const vat = shilling(i.vatDueMinor);
  const cash = shilling(i.cashOnHandMinor);
  const gap = shilling(i.cashGapMinor);
  const due = shortDate(i.vatDueDate, "he");

  switch (i.action) {
    case "pay_vat": {
      // If there's a cash gap we surface it explicitly; otherwise reassure.
      if (i.cashGapMinor > 0n) {
        return `${greeting} עד ${due} צריך להעביר ${vat} למע״מ. יש ${cash} בקופה — חסר ${gap}. הזמן לבקש תשלום מהלקוחות שטרם שילמו.`;
      }
      return `${greeting} עד ${due} צריך להעביר ${vat} למע״מ. יש ${cash} בקופה — מכוסה.`;
    }
    case "follow_up_overdue": {
      const overdueSum = shilling(i.overdueInvoiceTotalMinor);
      const noun = i.overdueInvoiceCount === 1 ? "חשבונית פתוחה" : "חשבוניות פתוחות";
      return `${greeting} ${i.overdueInvoiceCount} ${noun} מעל שבוע בלי תשלום, סך הכל ${overdueSum}. שלח תזכורת היום — זה מקרב את ${vat} המע״מ ב-${due}.`;
    }
    case "categorise_receipts": {
      const noun = i.pendingReceiptCount === 1 ? "קבלה לא מסווגת" : "קבלות לא מסווגות";
      const vendor = i.oldestPendingReceipt?.vendor ?? "ספק לא ידוע";
      const amount = i.oldestPendingReceipt
        ? shilling(i.oldestPendingReceipt.amountMinor)
        : null;
      const tail = amount
        ? `הכי ישנה: ${vendor}, ${amount}.`
        : `נסה לקטלג את הכי ישנה היום.`;
      // If we have a what-if hint, append it.
      if (i.vatIfCategorisedMinor != null && i.vatIfCategorisedMinor < i.vatDueMinor) {
        return `${greeting} ${i.pendingReceiptCount} ${noun}. ${tail} אם תקטלג כהוצאה מוכרת, המע״מ הצפוי ב-${due} יורד מ-${vat} ל-${shilling(i.vatIfCategorisedMinor)}.`;
      }
      return `${greeting} ${i.pendingReceiptCount} ${noun}. ${tail} כל אחת שתקטלג מורידה את ${vat} המע״מ הצפוי ב-${due}.`;
    }
    case "nothing_urgent":
    default: {
      // Friendly quiet-morning sentence — still surfaces the next deadline
      // so the user has an anchor.
      if (i.vatDueMinor > 0n) {
        return `${greeting} אין משימה דחופה היום. המע״מ הבא: ${vat} ב-${due}. תהנה מהבוקר.`;
      }
      return `${greeting} אין משימה דחופה היום. תהנה מהבוקר.`;
    }
  }
}

function renderEn(i: MorningBriefSentenceInput): string {
  const greeting = i.userName ? `Good morning ${i.userName}.` : "Good morning.";
  const vat = shilling(i.vatDueMinor);
  const cash = shilling(i.cashOnHandMinor);
  const gap = shilling(i.cashGapMinor);
  const due = shortDate(i.vatDueDate, "en");

  switch (i.action) {
    case "pay_vat": {
      if (i.cashGapMinor > 0n) {
        return `${greeting} You owe ${vat} VAT by ${due}. You have ${cash} on hand — short ${gap}. Time to chase the open invoices today.`;
      }
      return `${greeting} You owe ${vat} VAT by ${due}. You have ${cash} on hand — covered.`;
    }
    case "follow_up_overdue": {
      const overdueSum = shilling(i.overdueInvoiceTotalMinor);
      const noun = i.overdueInvoiceCount === 1 ? "invoice is" : "invoices are";
      return `${greeting} ${i.overdueInvoiceCount} ${noun} more than a week overdue, totalling ${overdueSum}. Send a reminder today — that brings ${vat} VAT (due ${due}) within reach.`;
    }
    case "categorise_receipts": {
      const noun = i.pendingReceiptCount === 1 ? "uncategorised receipt" : "uncategorised receipts";
      const vendor = i.oldestPendingReceipt?.vendor ?? "an unknown vendor";
      const amount = i.oldestPendingReceipt
        ? shilling(i.oldestPendingReceipt.amountMinor)
        : null;
      const tail = amount
        ? `Oldest: ${vendor}, ${amount}.`
        : `Take a minute on the oldest one today.`;
      if (i.vatIfCategorisedMinor != null && i.vatIfCategorisedMinor < i.vatDueMinor) {
        return `${greeting} ${i.pendingReceiptCount} ${noun}. ${tail} Categorising as a deductible drops the ${due} VAT estimate from ${vat} to ${shilling(i.vatIfCategorisedMinor)}.`;
      }
      return `${greeting} ${i.pendingReceiptCount} ${noun}. ${tail} Every one you categorise lowers the ${vat} VAT estimate due ${due}.`;
    }
    case "nothing_urgent":
    default: {
      if (i.vatDueMinor > 0n) {
        return `${greeting} Nothing urgent today. Next VAT: ${vat} by ${due}. Have a good one.`;
      }
      return `${greeting} Nothing urgent today. Have a good one.`;
    }
  }
}

/**
 * Format minor units as `₪X,YYY` — major units, comma-grouped, no agorot.
 * The Hebrew render uses left-to-right Bidi inside the sentence; placing
 * ₪ before the digits is the convention used elsewhere in this codebase
 * (see lib/ai/snapshot.ts `shilling()`).
 */
function shilling(n: bigint): string {
  const major = Number(n) / 100;
  // Use the user-facing "round to whole shekel" convention. Avoids
  // surfacing agorot in a habit-forming notification — too noisy.
  const rounded = Math.round(major);
  return `₪${rounded.toLocaleString("en-US")}`;
}

/**
 * Short date in the locale's idiomatic form.
 *
 *   he: "15.7"   (D.M, dot-separator — matches sample sentence from spec)
 *   en: "Jul 15" (short month + day, matches AccounTech voice)
 */
function shortDate(d: Date, lang: "he" | "en"): string {
  const day = d.getUTCDate();
  const monthIdx = d.getUTCMonth();
  if (lang === "he") {
    return `${day}.${monthIdx + 1}`;
  }
  const EN_MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${EN_MONTHS[monthIdx]} ${day}`;
}

/**
 * Exported for tests + the email template — same disclaimer text used
 * everywhere else in the tax surface.
 */
export const MORNING_BRIEF_DISCLAIMER: TaxDisclaimer = {
  he: "אומדנים בלבד · אינו ייעוץ מס · התייעצו עם רואה חשבון מורשה",
  en: "Estimates only · Not tax advice · Consult a licensed accountant",
};

export const __testing = {
  shilling,
  shortDate,
  disclaimerSuffixForLocale,
};
