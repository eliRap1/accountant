import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import LastSyncedBanner from "@/components/app/processor-sync/LastSyncedBanner";
import UnpairedReceiptsList, {
  type OrphanReceipt,
} from "@/components/app/processor-sync/UnpairedReceiptsList";
import SyncNowButton from "./SyncNowButton";

type CredentialRow = {
  id: string;
  processor: string;
  businessId: string;
  businessName: string;
  lastSyncedAt: string | null;
  consecutiveFailures: number;
};

type OrphanRow = {
  id: string;
  parsedAmountMinor: string;
  parsedDate: string;
  parsedVendorCiphertext: string | null;
};

function parseOrphanMetadata(raw: string | null): {
  customerLabel: string;
  receiptNumber: string | null;
  externalId: string | null;
  matchReason: "no_match" | "ambiguous" | "amount_date" | "exact";
} {
  if (!raw) {
    return {
      customerLabel: "",
      receiptNumber: null,
      externalId: null,
      matchReason: "no_match",
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<{
      customerLabel: string;
      receiptNumber: string;
      externalId: string;
      matchReason: "no_match" | "ambiguous" | "amount_date" | "exact";
    }>;
    return {
      customerLabel: parsed.customerLabel ?? "",
      receiptNumber: parsed.receiptNumber ?? null,
      externalId: parsed.externalId ?? null,
      matchReason: parsed.matchReason ?? "no_match",
    };
  } catch {
    return {
      customerLabel: "",
      receiptNumber: null,
      externalId: null,
      matchReason: "no_match",
    };
  }
}

export default async function ProcessorSyncPage() {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.processorSync");

  const { credentials, orphans } = await withUser(me.appUserId, async (tx) => {
    const credRows = (await tx.execute(
      sql`SELECT c.id::text AS id,
                 c.processor::text AS processor,
                 c.business_id::text AS "businessId",
                 b.legal_name AS "businessName",
                 c.last_synced_at::text AS "lastSyncedAt",
                 c.consecutive_failures AS "consecutiveFailures"
            FROM processor_sync_credentials c
            JOIN businesses b ON b.id = c.business_id
           WHERE c.active = true
           ORDER BY c.processor ASC, b.legal_name ASC`,
    )) as unknown as CredentialRow[];

    const orphanRows = (await tx.execute(
      sql`SELECT id::text AS id,
                 parsed_amount_minor::text AS "parsedAmountMinor",
                 parsed_date::text AS "parsedDate",
                 parsed_vendor_ciphertext AS "parsedVendorCiphertext"
            FROM receipts
           WHERE source = 'processor_sync'::receipt_source
             AND status = 'pending_review'::receipt_status
           ORDER BY parsed_date DESC
           LIMIT 50`,
    )) as unknown as OrphanRow[];

    return { credentials: credRows, orphans: orphanRows };
  });

  const orphanReceipts: OrphanReceipt[] = orphans.map((o) => {
    const meta = parseOrphanMetadata(o.parsedVendorCiphertext);
    return {
      id: o.id,
      parsedAmountMinor: o.parsedAmountMinor,
      parsedDate: o.parsedDate,
      customerLabel: meta.customerLabel,
      receiptNumber: meta.receiptNumber,
      matchReason: meta.matchReason,
    };
  });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
        </div>
        <Link
          href="/processor-sync/connect"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          <Plus size={14} />
          {t("connectCta")}
        </Link>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("connectedHeading")}
        </h2>
        {credentials.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center text-sm text-slate-400">
            {t("emptyState")}
          </div>
        ) : (
          <div className="glass rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  <th className="px-4 py-3 text-start">{t("col.processor")}</th>
                  <th className="px-4 py-3 text-start">{t("col.business")}</th>
                  <th className="px-4 py-3 text-start">{t("col.lastSynced")}</th>
                  <th className="px-4 py-3 text-end">{t("col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((c) => (
                  <tr key={c.id} className="border-b border-white/5">
                    <td className="px-4 py-3 text-slate-200">
                      {t(`processor.${c.processor}`)}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {c.businessName}
                    </td>
                    <td className="px-4 py-3">
                      <LastSyncedBanner
                        lastSyncedAt={c.lastSyncedAt}
                        consecutiveFailures={c.consecutiveFailures}
                      />
                    </td>
                    <td className="px-4 py-3 text-end">
                      <SyncNowButton credentialId={c.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("orphans.heading")}
        </h2>
        <p className="text-xs text-slate-500">{t("orphans.subtitle")}</p>
        <UnpairedReceiptsList rows={orphanReceipts} />
      </section>
    </div>
  );
}
