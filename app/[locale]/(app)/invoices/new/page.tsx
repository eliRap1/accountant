import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { IL_2026 } from "@/lib/tax/il/rules-2026";
import { activeThresholdAt } from "@/lib/invoices/allocationThreshold";
import InvoiceForm, {
  type BusinessOption,
  type ClientOption,
} from "../InvoiceForm";

export default async function NewInvoicePage() {
  const me = await requireCurrentUser();

  const { businesses, clients } = await withUser(me.appUserId, async (tx) => {
    const bs = (await tx.execute(
      sql`SELECT id, legal_name AS "legalName",
                 default_currency AS "defaultCurrency",
                 vat_status::text AS "vatStatus"
          FROM businesses
          WHERE deleted_at IS NULL
          ORDER BY legal_name ASC`,
    )) as unknown as BusinessOption[];

    const cs = (await tx.execute(
      sql`SELECT id, legal_name AS "legalName",
                 business_id AS "businessId"
          FROM clients
          WHERE deleted_at IS NULL
          ORDER BY legal_name ASC`,
    )) as unknown as ClientOption[];

    return { businesses: bs, clients: cs };
  });

  // Mirror server-side allocation threshold for today so the form's
  // banner is correct on first render. The actions.ts re-derives it
  // for the authoritative server-side gate.
  const threshold = activeThresholdAt(new Date()).toString();
  // VAT default in % (18) — the rule set keeps it as decimal 0.18.
  const defaultVatRatePct = IL_2026.vatStandardRate * 100;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <InvoiceForm
        mode="new"
        businesses={businesses}
        clients={clients}
        defaultVatRatePct={defaultVatRatePct}
        thresholdMinorStr={threshold}
      />
    </div>
  );
}
