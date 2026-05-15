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
    console.log("[db:seed] done.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[db:seed] failed:", err);
  process.exit(1);
});
