// Receipt → Transaction draft mapper.
//
// Given a successful OCR result and the owning business, derive a
// best-guess transaction draft for the operator to review. The mapper
// is INTENTIONALLY simple — the operator stays in the loop for the
// approve/reject pass (Plan v4: human-in-the-loop receipts).
//
// Heuristics:
//   1. Match the vendor name against a fixed vendor → category table
//      (lowercase substring match — covers the main Israeli SaaS, fuel,
//      food, telecom, and office-supply chains we expect).
//   2. If no vendor match, bucket by amount: > ₪1000 → "8400 office
//      equipment" expense; otherwise "8000 - misc expense".
//   3. Always default direction = "expense". The few inbound receipts
//      (קבלות from customers) are handled by the processor-sync flow,
//      not the OCR upload path.

import type { businesses } from "@/db/schema/businesses";
import type { transactions } from "@/db/schema/money-flows";
import type { OcrResult } from "./ocr";

export type Business = typeof businesses.$inferSelect;
export type TransactionDraft = Partial<typeof transactions.$inferInsert>;

// Vendor → IL standard chart-of-accounts code mapping. The codes match
// the standard COA seeded in scripts/db-seed.ts. Keep this list short —
// long lists rot fast and the operator review pass catches errors.
//
// Lowercase, accent-folded keys. Hebrew uses NFC-normalized literals
// directly; we do NOT match case-insensitively on Hebrew (no case in
// Hebrew script) — substring is enough.
type VendorRule = {
  // Substrings to test against the vendor name (case-insensitive for ASCII).
  needles: ReadonlyArray<string>;
  code: string;
  label: string;
};

const VENDOR_RULES: ReadonlyArray<VendorRule> = [
  // Telecom / connectivity
  { needles: ["bezeq", "בזק", "hot", "הוט", "cellcom", "סלקום", "partner", "פרטנר", "pelephone", "פלאפון"], code: "8200", label: "telecom" },
  // Software / SaaS
  { needles: ["google", "microsoft", "github", "vercel", "openai", "anthropic", "stripe", "atlassian", "slack", "notion", "figma", "adobe", "linear", "jetbrains", "aws", "amazon web", "cloudflare"], code: "8300", label: "software_saas" },
  // Fuel / transport
  { needles: ["paz", "פז", "delek", "דלק", "sonol", "סונול", "ten", "טן", "dor alon", "אלון"], code: "8500", label: "fuel" },
  // Food / restaurants (deductible business meals at lower rates)
  { needles: ["aroma", "ארומה", "cofix", "קופיקס", "wolt", "וולט", "10bis", "תן ביס", "תן-ביס", "rest", "מסעדה"], code: "8600", label: "meals" },
  // Office supplies
  { needles: ["office depot", "ofis", "אופיס", "ikea", "איקאה", "ace", "אייס"], code: "8400", label: "office_supplies" },
  // Bank fees / professional services (incl. credit card processor fees)
  { needles: ["bank", "בנק", "leumi", "לאומי", "hapoalim", "פועלים", "mizrahi", "מזרחי", "discount", "דיסקונט", "isracard", "ישראכרט", "max", "מקס", "cal", "כאל"], code: "8700", label: "bank_fees" },
  // Tax / government
  { needles: ["misim", "מע\"מ", "vat", "rashut hamisim", "רשות המסים", "ita", "ביטוח לאומי", "bituach leumi"], code: "8800", label: "government" },
];

/**
 * Map a vendor name to a chart_of_accounts code, or null if no rule
 * matches. Lowercase-folds ASCII; leaves Hebrew untouched.
 */
export function categoriseByVendor(vendor: string): {
  code: string;
  label: string;
} | null {
  const folded = vendor.toLowerCase();
  for (const rule of VENDOR_RULES) {
    for (const needle of rule.needles) {
      const n = /^[A-Za-z0-9 \-_.]+$/.test(needle) ? needle.toLowerCase() : needle;
      if (folded.includes(n)) {
        return { code: rule.code, label: rule.label };
      }
    }
  }
  return null;
}

/**
 * Amount-band fallback. Pure threshold — large-amount receipts are
 * probably equipment, small ones get the misc bucket. The operator
 * adjusts on the review screen.
 */
export function categoriseByAmount(amountMinor: bigint): {
  code: string;
  label: string;
} {
  // ₪1,000 in minor = 100_000. Above → equipment-ish.
  if (amountMinor >= 100_000n) {
    return { code: "8400", label: "office_supplies" };
  }
  return { code: "8000", label: "misc_expense" };
}

/**
 * Compose a transaction draft from the OCR result. The caller is
 * expected to attach businessId + linkedReceiptId before insert; this
 * function leaves them undefined since both come from the parent row.
 *
 * Strategy:
 *   - amountMinor = the full OCR total (already in minor).
 *   - direction = "expense" (the upload path is for outgoing receipts).
 *   - categoryCode = vendor rule → amount band → "8000".
 *   - description = vendor + first item if any.
 *   - txnDate = parsed date.
 */
export function parseReceiptToTransaction(
  ocr: OcrResult,
  business: Business,
): TransactionDraft {
  const byVendor = categoriseByVendor(ocr.vendor);
  const category = byVendor ?? categoriseByAmount(ocr.amount_minor);

  const firstItem = ocr.items[0]?.description;
  const description = firstItem
    ? `${ocr.vendor} — ${firstItem}`
    : ocr.vendor;

  return {
    businessId: business.id,
    direction: "expense",
    amountMinor: ocr.amount_minor,
    currency: ocr.currency,
    categoryCode: category.code,
    description,
    txnDate: ocr.date,
    source: "ocr",
  };
}
