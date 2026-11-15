// Chart-of-accounts code → Form 6111 line mapping.
//
// The standard IL chart-of-accounts codes (seeded in `scripts/db-seed.ts`
// CHART_OF_ACCOUNTS) each carry a `form_6111_line` column. This file
// provides app-layer access to that mapping for filing generators, with
// a safe fallback for codes whose mapping isn't yet confirmed.
//
// Source: ITA Form 6111 ("דו"ח התאמה לצרכי מס") spec maps every BS/P&L
// line to a numeric code. The full schedule lives in the ITA's "מבנה
// הקובץ" PDF appendix.
//
// <verify-this> The line numbers seeded into chart_of_accounts on
// 2026-05-16 are placeholders pending a CPA-reviewed mapping in Phase D
// (`lib/tax/il/rules-2026.ts`). For any code not yet mapped, this module
// returns `null` and logs a one-time warning.
//
// Web-fetch status (2026-05-16):
//   - https://www.gov.il/he/service/UniformDigitalFile-6111 → 404
//   - https://www.gov.il/he/Departments/General/itc874 → CF-blocked from
//     the agent sandbox.
//   Authoritative line table NOT obtainable here; using db-seed.ts'
//   placeholder values, flagged.
//
// This file is INTENTIONALLY data-light — the real source of truth is
// the chart_of_accounts table. We export only:
//   1. `categoryCodeTo6111Line(code)` — runtime resolver that falls back
//      to the in-memory snapshot below if no DB is provided.
//   2. `line6111ToDescription(line)` — human-readable bilingual labels
//      for the 6111 lines we currently know about. Used by the prep-pack
//      generators (form1301, form1214) to render line names in the PDF.

// Snapshot of the standard chart_of_accounts seed (business_id NULL rows).
// Kept in lockstep with `scripts/db-seed.ts` CHART_OF_ACCOUNTS. If the seed
// list changes, this constant MUST be updated; the cat-to-6111.test.ts
// test enforces parity by importing both.
//
// NOTE: This is the *seed* snapshot only. Per-business overrides held in
// `chart_of_accounts` rows with non-null business_id must be resolved at
// runtime by a DB-aware resolver (Phase D wires that in).
export const STANDARD_CHART_TO_6111: ReadonlyMap<string, string | null> = new Map([
  // 1xxx — Assets
  ["1000", "1010"],
  ["1010", "1011"],
  ["1020", "1011"],
  ["1030", "1011"],
  ["1100", "1020"],
  ["1150", "1020"],
  ["1200", "1040"],
  ["1300", "1050"],
  ["1400", "1060"],
  ["1450", null], // withholding-tax credit — 6111 line unconfirmed
  ["1500", "1070"],
  ["1510", "1071"],
  ["1590", "1075"],
  // 2xxx — Liabilities
  ["2000", "2010"],
  ["2100", "2020"],
  ["2150", "2020"],
  ["2200", "2030"],
  ["2250", "2031"],
  ["2300", "2040"],
  ["2400", "2050"],
  ["2500", "2060"],
  ["2600", "2070"],
  // 3xxx — Equity
  ["3000", "3010"],
  ["3100", "3020"],
  ["3200", "3030"],
  ["3300", "3040"],
  // 4xxx — Income
  ["4000", "4010"],
  ["4100", "4020"],
  ["4200", "4030"],
  ["4900", "4090"],
  // 5xxx — Cost of sales
  ["5000", "5010"],
  ["5100", "5020"],
  // 6xxx — Selling & marketing
  ["6000", "6010"],
  ["6100", "6020"],
  // 7xxx — G&A
  ["7000", "7010"],
  ["7100", "7020"],
  ["7150", "7021"],
  ["7200", "7030"],
  ["7300", "7040"],
  ["7310", "7041"],
  ["7400", "7050"],
  ["7500", "7060"],
  ["7600", "7070"],
  ["7700", "7080"],
  ["7800", "7090"],
  // 8xxx — Financial
  ["8000", "8010"],
  ["8100", "8020"],
  ["8500", "8030"],
]);

// Track which codes have been warned about so we only log once per code
// per process. Filings can iterate thousands of journal lines; we do not
// want the log to drown them.
const WARNED_UNMAPPED = new Set<string>();

type WarnFn = (msg: string) => void;

/** Default logger — overridable via `setUnmappedWarner` for tests. */
let warnFn: WarnFn = (msg) => {
  // Using console.warn directly is fine for a CLI / dev surface. In
  // production this could be wired to lib/observability/logging once
  // that ships (P3 deferred per handoff.md).
  // eslint-disable-next-line no-console
  console.warn(msg);
};

/** Inject a custom warner. Returns the previous warner for restoration. */
export function setUnmappedWarner(fn: WarnFn): WarnFn {
  const prev = warnFn;
  warnFn = fn;
  return prev;
}

/** Reset the "already warned" memo. Test helper. */
export function _resetWarnedUnmapped(): void {
  WARNED_UNMAPPED.clear();
}

/**
 * Resolve a chart-of-accounts code to its 6111 line number.
 *
 * Returns `null` for:
 *   - unknown codes (warns once per code)
 *   - known codes whose 6111 line is not yet mapped (warns once per code)
 *
 * The caller is responsible for deciding what to do with `null` — the
 * filing generator may aggregate unmapped amounts into a catch-all line
 * or surface a "needs CPA review" warning on the prep-pack summary.
 */
export function categoryCodeTo6111Line(code: string): string | null {
  if (typeof code !== "string" || code.length === 0) {
    return null;
  }
  if (!STANDARD_CHART_TO_6111.has(code)) {
    if (!WARNED_UNMAPPED.has(code)) {
      WARNED_UNMAPPED.add(code);
      warnFn(
        `[cat-to-6111] unknown chart_of_accounts code ${JSON.stringify(code)} — no 6111 line mapping (returning null)`,
      );
    }
    return null;
  }
  const line = STANDARD_CHART_TO_6111.get(code) ?? null;
  if (line === null && !WARNED_UNMAPPED.has(code)) {
    WARNED_UNMAPPED.add(code);
    warnFn(
      `[cat-to-6111] chart_of_accounts code ${JSON.stringify(code)} has no 6111 line yet (returning null)`,
    );
  }
  return line;
}

/**
 * Bilingual descriptions for the 6111 lines we currently emit. Strictly
 * a UX helper — used by form1301PrepPack / form1214PrepPack to render
 * line names alongside totals in the printable PDF summary.
 *
 * Unknown line → returns the line code itself for both locales so the
 * caller never has to guard against undefined.
 */
const LINE_DESCRIPTIONS: ReadonlyMap<string, { he: string; en: string }> =
  new Map([
    ["1010", { he: "מזומנים בקופה", en: "Cash on hand" }],
    ["1011", { he: "מזומנים בבנקים", en: "Cash at banks" }],
    ["1020", { he: "לקוחות וחייבים", en: "Trade receivables" }],
    ["1040", { he: "מלאי", en: "Inventory" }],
    ["1050", { he: "הוצאות נדחות / מקדמות", en: "Prepaid expenses / advances" }],
    ["1060", { he: "מע\"מ תשומות", en: "VAT inputs (recoverable)" }],
    ["1070", { he: "רכוש קבוע - ציוד", en: "Fixed assets - equipment" }],
    ["1071", { he: "רכוש קבוע - רכב", en: "Fixed assets - vehicles" }],
    ["1075", { he: "פחת נצבר", en: "Accumulated depreciation" }],
    ["2010", { he: "ספקים וזכאים", en: "Trade payables" }],
    ["2020", { he: "מע\"מ עסקאות", en: "VAT outputs (payable)" }],
    ["2030", { he: "מקדמות מס הכנסה", en: "Income tax advances" }],
    ["2031", { he: "ניכוי מס במקור - מספקים", en: "Withholding payable" }],
    ["2040", { he: "ביטוח לאומי", en: "Bituach Leumi payable" }],
    ["2050", { he: "הלוואות לזמן קצר", en: "Short-term loans" }],
    ["2060", { he: "הלוואות לזמן ארוך", en: "Long-term loans" }],
    ["2070", { he: "הוצאות לשלם", en: "Accrued expenses" }],
    ["3010", { he: "הון בעלים", en: "Owner's equity" }],
    ["3020", { he: "משיכות בעלים", en: "Owner's draws" }],
    ["3030", { he: "עודפים", en: "Retained earnings" }],
    ["3040", { he: "הון מניות", en: "Share capital" }],
    ["4010", { he: "הכנסות מעבודה / שירותים", en: "Service revenue" }],
    ["4020", { he: "הכנסות ממכירת מוצרים", en: "Product revenue" }],
    ["4030", { he: "הכנסות מיצוא", en: "Export revenue (zero-rated)" }],
    ["4090", { he: "הכנסות אחרות", en: "Other income" }],
    ["5010", { he: "עלות המכר", en: "Cost of goods sold" }],
    ["5020", { he: "קבלני משנה", en: "Subcontractors" }],
    ["6010", { he: "פרסום ושיווק", en: "Advertising & marketing" }],
    ["6020", { he: "עמלות מכירה", en: "Sales commissions" }],
    ["7010", { he: "שכירות", en: "Rent" }],
    ["7020", { he: "חשמל ומים", en: "Utilities" }],
    ["7021", { he: "תקשורת", en: "Telephone & internet" }],
    ["7030", { he: "ביטוחים", en: "Insurance" }],
    ["7040", { he: "משכורות", en: "Wages & salaries" }],
    ["7041", { he: "תשלומים סוציאליים", en: "Employer social benefits" }],
    ["7050", { he: "הוצאות רכב", en: "Vehicle expenses" }],
    ["7060", { he: "שירותים מקצועיים", en: "Professional services" }],
    ["7070", { he: "מחשוב ותוכנה", en: "Computing & software" }],
    ["7080", { he: "ציוד משרדי", en: "Office supplies" }],
    ["7090", { he: "פחת", en: "Depreciation" }],
    ["8010", { he: "עמלות בנק", en: "Bank fees" }],
    ["8020", { he: "ריבית והוצאות מימון", en: "Interest & finance charges" }],
    ["8030", { he: "הפרשי שער", en: "FX differences" }],
  ]);

/**
 * Human-readable description for a 6111 line. Falls back to `{ he: line,
 * en: line }` on unknown line so callers can render the line code as the
 * label of last resort.
 */
export function line6111ToDescription(line: string): { he: string; en: string } {
  const found = LINE_DESCRIPTIONS.get(line);
  if (found) return found;
  return { he: line, en: line };
}
