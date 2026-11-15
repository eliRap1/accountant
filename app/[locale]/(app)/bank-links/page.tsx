// STUB IMPLEMENTATION — Salt Edge integration pending vendor signoff.
// Once contract lands, replace `connectBank` server action with a Salt
// Edge Connect Widget redirect + webhook handler. The DB schema and
// UI flow are intentionally close to Salt Edge's data shape so the
// swap is mechanical:
//   - bank_connections.provider_connection_id <- Salt Edge connection_id
//   - bank_connections.consent_expires_at     <- Salt Edge consent.expires_at
//   - bank_connections.metadata_jsonb         <- raw Salt Edge response
//
// See docs/superpowers/plans/2026-05-17-openai-parity.md "Out of scope
// (Phase 3)" for full integration plan.

import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import ConnectBankButton from "./ConnectBankButton";

type ConnectionRow = {
  id: string;
  bankSlug: string;
  displayName: string;
  status: string;
  provider: string;
  lastSyncedAt: string | null;
  consecutiveFailures: number;
  createdAt: string;
  businessName: string;
  businessId: string;
};

function StatusPill({ status }: { status: string }) {
  const colour =
    status === "active"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
      : status === "failed"
        ? "border-red-400/40 bg-red-500/10 text-red-200"
        : "border-amber-400/40 bg-amber-500/10 text-amber-100";
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] ${colour}`}
    >
      {status}
    </span>
  );
}

export default async function BankLinksPage() {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.bankLinks");

  const { connections, firstBusinessId } = await withUser(
    me.appUserId,
    async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT bc.id::text AS id,
                   bc.bank_slug AS "bankSlug",
                   bc.display_name AS "displayName",
                   bc.status::text AS status,
                   bc.provider::text AS provider,
                   bc.last_synced_at::text AS "lastSyncedAt",
                   bc.consecutive_failures AS "consecutiveFailures",
                   bc.created_at::text AS "createdAt",
                   b.legal_name AS "businessName",
                   b.id::text AS "businessId"
              FROM bank_connections bc
              JOIN businesses b ON b.id = bc.business_id
             ORDER BY bc.created_at DESC
             LIMIT 100`,
      )) as unknown as ConnectionRow[];

      const bizRows = (await tx.execute(
        sql`SELECT id::text AS id FROM businesses
             WHERE owner_user_id = current_setting('app.current_user_id', true)::uuid
             ORDER BY created_at ASC
             LIMIT 1`,
      )) as unknown as Array<{ id: string }>;

      return {
        connections: rows,
        firstBusinessId: bizRows[0]?.id ?? null,
      };
    },
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
        </div>
        {firstBusinessId && (
          <ConnectBankButton businessId={firstBusinessId} />
        )}
      </header>

      {connections.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center text-sm text-slate-400">
          {t("emptyState")}
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <th className="px-4 py-3 text-start">{t("col.bank")}</th>
                <th className="px-4 py-3 text-start">{t("col.business")}</th>
                <th className="px-4 py-3 text-start">{t("col.status")}</th>
                <th className="px-4 py-3 text-start">{t("col.provider")}</th>
                <th className="px-4 py-3 text-start">{t("col.connectedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id} className="border-b border-white/5">
                  <td className="px-4 py-3 text-slate-200">{c.displayName}</td>
                  <td className="px-4 py-3 text-slate-200">{c.businessName}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-400" dir="ltr">
                    {c.provider}
                  </td>
                  <td className="px-4 py-3 text-slate-300" dir="ltr">
                    {c.createdAt.slice(0, 16).replace("T", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
