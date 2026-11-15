import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import FilingList, { type FilingRow, type FilingKind } from "./FilingList";

// /filings — the operator's filings inbox.
//
// Grouped by kind (PCN874 first because monthly + most common, then the
// six annual forms in regulator order). Per-row status badge:
//   - draft       → generator started but the artefact isn't ready yet
//   - generated   → "ready for portal upload" (default)
//   - downloaded  → operator pulled the file (step-up verified)
//   - submitted   → operator marked it as uploaded to the regulator's
//                   portal + pasted an asmachta.
//
// The "filed" word is forbidden — see CLAUDE/CPA-council positioning.
// We never present a status that implies AccounTech itself filed on
// the operator's behalf.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.filings" });
  return { title: t("metaTitle") };
}

type RawFilingRow = {
  id: string;
  businessId: string;
  businessName: string;
  kind: FilingKind;
  periodStart: string;
  periodEnd: string;
  generatedAt: Date | string;
  status: FilingRow["status"];
  submittedAt: Date | string | null;
  submittedAsmachta: string | null;
  fileMime: string | null;
};

type EntitlementBoolRow = { key: string; value_bool: boolean | null };

export default async function FilingsPage() {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.filings");

  const { rows, entitlements } = await withUser(me.appUserId, async (tx) => {
    const data = (await tx.execute(
      sql`SELECT tf.id::text AS id,
                 tf.business_id::text AS "businessId",
                 b.legal_name AS "businessName",
                 tf.kind::text AS kind,
                 tf.period_start::text AS "periodStart",
                 tf.period_end::text AS "periodEnd",
                 tf.generated_at AS "generatedAt",
                 tf.status::text AS status,
                 tf.submitted_at AS "submittedAt",
                 tf.submitted_asmachta AS "submittedAsmachta",
                 tf.file_mime AS "fileMime"
            FROM tax_filings tf
            JOIN businesses b ON b.id = tf.business_id
           WHERE b.deleted_at IS NULL
           ORDER BY tf.period_end DESC, tf.generated_at DESC
           LIMIT 500`,
    )) as unknown as RawFilingRow[];

    // Entitlements are read with service role (the `plan_entitlements`
    // table is public-readable but we go through withServiceRole here
    // for symmetry with other surfaces — see app/api/ai/chat/route.ts).
    const entRows = await withServiceRole(async (svc) => {
      return (await svc.execute(
        sql`SELECT pe.key, pe.value_bool
              FROM plan_entitlements pe
              JOIN subscriptions s ON s.plan_id = pe.plan_id
             WHERE s.user_id = ${me.appUserId}::uuid
               AND s.status IN ('active','trialing')
               AND pe.key IN ('filings.pcn874', 'filings.form_exports')
             ORDER BY s.created_at DESC`,
      )) as unknown as EntitlementBoolRow[];
    });

    let canPcn = false;
    let canForms = false;
    for (const row of entRows) {
      if (row.key === "filings.pcn874" && row.value_bool) canPcn = true;
      if (row.key === "filings.form_exports" && row.value_bool) canForms = true;
    }

    // Fallback to the free plan if no active subscription is found.
    if (entRows.length === 0) {
      const free = await withServiceRole(async (svc) => {
        return (await svc.execute(
          sql`SELECT key, value_bool
                FROM plan_entitlements
                WHERE plan_id = 'free'
                  AND key IN ('filings.pcn874', 'filings.form_exports')`,
        )) as unknown as EntitlementBoolRow[];
      });
      for (const row of free) {
        if (row.key === "filings.pcn874" && row.value_bool) canPcn = true;
        if (row.key === "filings.form_exports" && row.value_bool) canForms = true;
      }
    }

    const normalised: FilingRow[] = data.map((r) => ({
      id: r.id,
      businessId: r.businessId,
      businessName: r.businessName,
      kind: r.kind,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      generatedAt:
        r.generatedAt instanceof Date
          ? r.generatedAt.toISOString()
          : String(r.generatedAt),
      status: r.status,
      submittedAt:
        r.submittedAt === null
          ? null
          : r.submittedAt instanceof Date
            ? r.submittedAt.toISOString()
            : String(r.submittedAt),
      submittedAsmachta: r.submittedAsmachta,
      fileMime: r.fileMime,
    }));

    return {
      rows: normalised,
      entitlements: { canPcn, canForms },
    };
  });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 space-y-6">
      <EstimatesDisclaimerBanner />

      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
        </div>
        <Link
          href={"/filings/new" as Route}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          {t("addCta")}
        </Link>
      </header>

      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-100/80">
        {t("neverFiled")}
      </div>

      <FilingList
        rows={rows}
        canPcn={entitlements.canPcn}
        canForms={entitlements.canForms}
      />
    </div>
  );
}
