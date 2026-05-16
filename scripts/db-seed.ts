import { existsSync } from "node:fs";
import process from "node:process";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

import postgres from "postgres";

// Plan v4 — 5 tiers. priceMinor is in agorot (1 NIS = 100 agorot).
// integer value_int sentinel: -1 = unlimited; 0 = explicit zero limit.
type PlanSeed = {
  id: string;
  name: string;
  priceMinor: bigint;
  sort: number;
  entitlements: Record<
    string,
    { valueInt?: number; valueBool?: boolean }
  >;
};

const PLANS: PlanSeed[] = [
  {
    id: "free",
    name: "Free",
    priceMinor: 0n,
    sort: 0,
    entitlements: {
      "businesses.max": { valueInt: 1 },
      "invoices.per_month_max": { valueInt: 10 },
      "ai.messages_per_month_max": { valueInt: 0 },
      "filings.pcn874": { valueBool: false },
      "filings.form_exports": { valueBool: false },
      "bank.import": { valueBool: false },
      "receipts.ocr": { valueBool: false },
      "processor.sync": { valueBool: false },
      "partners.invoice_providers": { valueBool: false },
      "engagements.as_accountant": { valueBool: false },
      "ops.bulk": { valueBool: false },
      "support.priority": { valueBool: false },
      "audit.package_builder": { valueBool: false },
    },
  },
  {
    id: "solo",
    name: "Solo",
    priceMinor: 4900n,
    sort: 1,
    entitlements: {
      "businesses.max": { valueInt: 1 },
      "invoices.per_month_max": { valueInt: -1 },
      "ai.messages_per_month_max": { valueInt: 50 },
      "filings.pcn874": { valueBool: true },
      "filings.form_exports": { valueBool: false },
      "bank.import": { valueBool: false },
      "receipts.ocr": { valueBool: false },
      "processor.sync": { valueBool: false },
      "partners.invoice_providers": { valueBool: false },
      "engagements.as_accountant": { valueBool: false },
      "ops.bulk": { valueBool: false },
      "support.priority": { valueBool: false },
      "audit.package_builder": { valueBool: false },
    },
  },
  {
    id: "plus",
    name: "Plus",
    priceMinor: 9900n,
    sort: 2,
    entitlements: {
      "businesses.max": { valueInt: 2 },
      "invoices.per_month_max": { valueInt: -1 },
      "ai.messages_per_month_max": { valueInt: 200 },
      "filings.pcn874": { valueBool: true },
      "filings.form_exports": { valueBool: true },
      "bank.import": { valueBool: true },
      "receipts.ocr": { valueBool: true },
      "processor.sync": { valueBool: false },
      "partners.invoice_providers": { valueBool: false },
      "engagements.as_accountant": { valueBool: false },
      "ops.bulk": { valueBool: false },
      "support.priority": { valueBool: false },
      "audit.package_builder": { valueBool: false },
    },
  },
  {
    id: "business",
    name: "Business",
    priceMinor: 19900n,
    sort: 3,
    entitlements: {
      "businesses.max": { valueInt: 5 },
      "invoices.per_month_max": { valueInt: -1 },
      "ai.messages_per_month_max": { valueInt: -1 },
      "filings.pcn874": { valueBool: true },
      "filings.form_exports": { valueBool: true },
      "bank.import": { valueBool: true },
      "receipts.ocr": { valueBool: true },
      "processor.sync": { valueBool: true },
      "partners.invoice_providers": { valueBool: true },
      "engagements.as_accountant": { valueBool: false },
      "ops.bulk": { valueBool: false },
      "support.priority": { valueBool: true },
      "audit.package_builder": { valueBool: true },
    },
  },
  {
    id: "accountant",
    name: "Accountant",
    priceMinor: 39900n,
    sort: 4,
    entitlements: {
      "businesses.max": { valueInt: 5 },
      "invoices.per_month_max": { valueInt: -1 },
      "ai.messages_per_month_max": { valueInt: -1 },
      "filings.pcn874": { valueBool: true },
      "filings.form_exports": { valueBool: true },
      "bank.import": { valueBool: true },
      "receipts.ocr": { valueBool: true },
      "processor.sync": { valueBool: true },
      "partners.invoice_providers": { valueBool: true },
      "engagements.as_accountant": { valueBool: true },
      "ops.bulk": { valueBool: true },
      "support.priority": { valueBool: true },
      "audit.package_builder": { valueBool: true },
    },
  },
];

// Standard IL CPA chart-of-accounts (4-digit codes), business_id = NULL.
// Form 6111 line numbers reference the ITA's standard mapping schedule.
// Lines we don't yet have a confirmed mapping for are left as null; Phase D
// fills them in based on the rules-2026 source-of-truth review.
type ChartCodeSeed = {
  code: string;
  nameHe: string;
  nameEn: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  form6111Line: string | null;
};

const CHART_OF_ACCOUNTS: ChartCodeSeed[] = [
  // 1xxx — Assets
  { code: "1000", nameHe: "מזומנים בקופה", nameEn: "Cash on hand", type: "asset", form6111Line: "1010" },
  { code: "1010", nameHe: "חשבון בנק - שוטף", nameEn: "Bank account - current", type: "asset", form6111Line: "1011" },
  { code: "1020", nameHe: "חשבון בנק - חיסכון", nameEn: "Bank account - savings", type: "asset", form6111Line: "1011" },
  { code: "1030", nameHe: "כרטיסי אשראי לחיוב", nameEn: "Credit card receivable", type: "asset", form6111Line: "1011" },
  { code: "1100", nameHe: "לקוחות - חייבים", nameEn: "Accounts receivable", type: "asset", form6111Line: "1020" },
  { code: "1150", nameHe: "המחאות לגבייה", nameEn: "Checks for collection", type: "asset", form6111Line: "1020" },
  { code: "1200", nameHe: "מלאי", nameEn: "Inventory", type: "asset", form6111Line: "1040" },
  { code: "1300", nameHe: "הוצאות נדחות / מקדמות לספקים", nameEn: "Prepaid expenses / supplier advances", type: "asset", form6111Line: "1050" },
  { code: "1400", nameHe: "מע\"מ תשומות", nameEn: "VAT inputs (recoverable)", type: "asset", form6111Line: "1060" },
  { code: "1450", nameHe: "ניכוי מס במקור - לזכותנו", nameEn: "Withholding tax credit (clients withheld)", type: "asset", form6111Line: null },
  { code: "1500", nameHe: "רכוש קבוע - ציוד", nameEn: "Fixed assets - equipment", type: "asset", form6111Line: "1070" },
  { code: "1510", nameHe: "רכוש קבוע - רכב", nameEn: "Fixed assets - vehicles", type: "asset", form6111Line: "1071" },
  { code: "1590", nameHe: "פחת נצבר", nameEn: "Accumulated depreciation", type: "asset", form6111Line: "1075" },
  // 2xxx — Liabilities
  { code: "2000", nameHe: "ספקים - זכאים", nameEn: "Accounts payable", type: "liability", form6111Line: "2010" },
  { code: "2100", nameHe: "מע\"מ עסקאות", nameEn: "VAT outputs (payable)", type: "liability", form6111Line: "2020" },
  { code: "2150", nameHe: "מע\"מ לתשלום", nameEn: "VAT net payable", type: "liability", form6111Line: "2020" },
  { code: "2200", nameHe: "מקדמות מס הכנסה", nameEn: "Income tax advances payable", type: "liability", form6111Line: "2030" },
  { code: "2250", nameHe: "ניכוי מס במקור - מספקים", nameEn: "Withholding tax payable (we withheld)", type: "liability", form6111Line: "2031" },
  { code: "2300", nameHe: "ביטוח לאומי", nameEn: "Bituach Leumi payable", type: "liability", form6111Line: "2040" },
  { code: "2400", nameHe: "הלוואות לזמן קצר", nameEn: "Short-term loans", type: "liability", form6111Line: "2050" },
  { code: "2500", nameHe: "הלוואות לזמן ארוך", nameEn: "Long-term loans", type: "liability", form6111Line: "2060" },
  { code: "2600", nameHe: "הוצאות לשלם", nameEn: "Accrued expenses", type: "liability", form6111Line: "2070" },
  // 3xxx — Equity
  { code: "3000", nameHe: "הון בעלים", nameEn: "Owner's equity", type: "equity", form6111Line: "3010" },
  { code: "3100", nameHe: "משיכות בעלים", nameEn: "Owner's draws", type: "equity", form6111Line: "3020" },
  { code: "3200", nameHe: "עודפים / רווחים שלא חולקו", nameEn: "Retained earnings", type: "equity", form6111Line: "3030" },
  { code: "3300", nameHe: "הון מניות", nameEn: "Share capital", type: "equity", form6111Line: "3040" },
  // 4xxx — Income
  { code: "4000", nameHe: "הכנסות ממכירת שירותים", nameEn: "Service revenue", type: "income", form6111Line: "4010" },
  { code: "4100", nameHe: "הכנסות ממכירת מוצרים", nameEn: "Product revenue", type: "income", form6111Line: "4020" },
  { code: "4200", nameHe: "הכנסות מיצוא", nameEn: "Export revenue (zero-rated)", type: "income", form6111Line: "4030" },
  { code: "4900", nameHe: "הכנסות אחרות", nameEn: "Other income", type: "income", form6111Line: "4090" },
  // 5xxx — Cost of sales
  { code: "5000", nameHe: "עלות המכר", nameEn: "Cost of goods sold", type: "expense", form6111Line: "5010" },
  { code: "5100", nameHe: "קבלני משנה", nameEn: "Subcontractors", type: "expense", form6111Line: "5020" },
  // 6xxx — Selling & marketing expenses
  { code: "6000", nameHe: "פרסום ושיווק", nameEn: "Advertising & marketing", type: "expense", form6111Line: "6010" },
  { code: "6100", nameHe: "עמלות מכירה", nameEn: "Sales commissions", type: "expense", form6111Line: "6020" },
  // 7xxx — General & admin expenses
  { code: "7000", nameHe: "שכירות", nameEn: "Rent", type: "expense", form6111Line: "7010" },
  { code: "7100", nameHe: "חשמל ומים", nameEn: "Utilities (electricity & water)", type: "expense", form6111Line: "7020" },
  { code: "7150", nameHe: "תקשורת וטלפון", nameEn: "Telephone & internet", type: "expense", form6111Line: "7021" },
  { code: "7200", nameHe: "ביטוחים", nameEn: "Insurance", type: "expense", form6111Line: "7030" },
  { code: "7300", nameHe: "משכורות", nameEn: "Wages & salaries", type: "expense", form6111Line: "7040" },
  { code: "7310", nameHe: "תשלומים סוציאליים", nameEn: "Social benefits (employer share)", type: "expense", form6111Line: "7041" },
  { code: "7400", nameHe: "הוצאות רכב", nameEn: "Vehicle expenses", type: "expense", form6111Line: "7050" },
  { code: "7500", nameHe: "שירותים מקצועיים", nameEn: "Professional services", type: "expense", form6111Line: "7060" },
  { code: "7600", nameHe: "מחשוב ותוכנה", nameEn: "Computing & software", type: "expense", form6111Line: "7070" },
  { code: "7700", nameHe: "ציוד משרדי", nameEn: "Office supplies", type: "expense", form6111Line: "7080" },
  { code: "7800", nameHe: "פחת", nameEn: "Depreciation", type: "expense", form6111Line: "7090" },
  // 8xxx — Financial expenses / income
  { code: "8000", nameHe: "עמלות בנק", nameEn: "Bank fees", type: "expense", form6111Line: "8010" },
  { code: "8100", nameHe: "ריבית והוצאות מימון", nameEn: "Interest & finance charges", type: "expense", form6111Line: "8020" },
  { code: "8500", nameHe: "הפרשי שער", nameEn: "FX differences", type: "expense", form6111Line: "8030" },
];

async function main() {
  const url =
    process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"];
  if (!url) {
    console.error("Missing DATABASE_URL_UNPOOLED / DATABASE_URL in env");
    process.exit(1);
  }

  console.log("[db:seed] connecting to Neon (unpooled)...");
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    for (const plan of PLANS) {
      await sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE app_service`;
        await tx`
          INSERT INTO plans (id, name, price_minor, currency, billing_interval, sort)
          VALUES (${plan.id}, ${plan.name}, ${plan.priceMinor.toString()}::bigint, 'ILS', 'month', ${plan.sort})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            price_minor = EXCLUDED.price_minor,
            sort = EXCLUDED.sort,
            updated_at = now()
        `;
        for (const [key, entitlement] of Object.entries(plan.entitlements)) {
          await tx`
            INSERT INTO plan_entitlements (plan_id, key, value_int, value_bool)
            VALUES (
              ${plan.id},
              ${key},
              ${entitlement.valueInt ?? null},
              ${entitlement.valueBool ?? null}
            )
            ON CONFLICT (plan_id, key) DO UPDATE SET
              value_int = EXCLUDED.value_int,
              value_bool = EXCLUDED.value_bool,
              updated_at = now()
          `;
        }
        console.log(`[db:seed] plan ${plan.id}: ${Object.keys(plan.entitlements).length} entitlements`);
      });
    }
    // Standard chart-of-accounts codes (business_id = NULL). Idempotent via
    // the partial unique index `chart_of_accounts_standard_code_idx`
    // (UNIQUE (code) WHERE business_id IS NULL). The WHERE clause in
    // ON CONFLICT must match the index predicate exactly for Postgres
    // to infer the arbiter.
    await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE app_service`;
      for (const code of CHART_OF_ACCOUNTS) {
        await tx`
          INSERT INTO chart_of_accounts (business_id, code, name_he, name_en, type, form_6111_line, is_active)
          VALUES (
            NULL,
            ${code.code},
            ${code.nameHe},
            ${code.nameEn},
            ${code.type}::chart_of_accounts_type,
            ${code.form6111Line},
            true
          )
          ON CONFLICT (code) WHERE business_id IS NULL DO UPDATE SET
            name_he = EXCLUDED.name_he,
            name_en = EXCLUDED.name_en,
            type = EXCLUDED.type,
            form_6111_line = EXCLUDED.form_6111_line,
            updated_at = now()
        `;
      }
      console.log(`[db:seed] chart_of_accounts: ${CHART_OF_ACCOUNTS.length} standard codes`);
    });

    console.log("[db:seed] done.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[db:seed] failed:", err);
  process.exit(1);
});
