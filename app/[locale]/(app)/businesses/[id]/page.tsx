import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Pencil } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";

type Props = { params: Promise<{ id: string; locale: string }> };

type BusinessDetailRow = {
  id: string;
  legalName: string;
  vatId: string;
  entityType: string;
  vatStatus: string;
  bookkeepingMethod: string;
  taxYearEndMonth: number;
  advanceTaxRatePct: string | null;
  tikNikuyim: string | null;
  defaultCurrency: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
  ilMunicipalAuthority: string | null;
};

type VatHistoryRow = {
  id: string;
  entityType: string;
  vatStatus: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
};

export default async function BusinessDetailPage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();
  const t = await getTranslations("app.businesses");

  const { business, history } = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id, legal_name AS "legalName", vat_id AS "vatId",
                 entity_type AS "entityType", vat_status AS "vatStatus",
                 bookkeeping_method AS "bookkeepingMethod",
                 tax_year_end_month AS "taxYearEndMonth",
                 advance_tax_rate_pct AS "advanceTaxRatePct",
                 tik_nikuyim AS "tikNikuyim",
                 default_currency AS "defaultCurrency",
                 address_street AS "addressStreet",
                 address_city AS "addressCity",
                 address_postal_code AS "addressPostalCode",
                 address_country AS "addressCountry",
                 il_municipal_authority AS "ilMunicipalAuthority"
          FROM businesses
          WHERE id = ${id}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as BusinessDetailRow[];

    const hist = (await tx.execute(
      sql`SELECT id, entity_type AS "entityType", vat_status AS "vatStatus",
                 effective_from AS "effectiveFrom",
                 effective_to AS "effectiveTo",
                 reason
          FROM business_vat_status_history
          WHERE business_id = ${id}::uuid
          ORDER BY effective_from DESC`,
    )) as unknown as VatHistoryRow[];

    return { business: rows[0] ?? null, history: hist };
  });

  if (!business) notFound();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {business.legalName}
          </h1>
          <p
            className="mt-1 text-sm text-slate-400"
            dir="ltr"
          >
            {business.vatId}
          </p>
        </div>
        <Link
          href={`/businesses/${business.id}/edit`}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
        >
          <Pencil size={14} />
          {t("col.edit")}
        </Link>
      </header>

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.profile")}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
          <DescRow label={t("entityType")}>
            {t(`entityOption.${business.entityType}`)}
          </DescRow>
          <DescRow label={t("vatStatus")}>
            {t(`vatStatusOption.${business.vatStatus}`)}
          </DescRow>
          <DescRow label={t("bookkeepingMethod")}>
            {t(`bookkeepingOption.${business.bookkeepingMethod}`)}
          </DescRow>
          <DescRow label={t("defaultCurrency")}>
            <span dir="ltr">{business.defaultCurrency}</span>
          </DescRow>
          <DescRow label={t("taxYearEndMonth")}>
            <span dir="ltr">{business.taxYearEndMonth}</span>
          </DescRow>
          <DescRow label={t("advanceTaxRatePct")}>
            <span dir="ltr">{business.advanceTaxRatePct ?? "—"}</span>
          </DescRow>
          <DescRow label={t("tikNikuyim")}>
            <span dir="ltr">{business.tikNikuyim ?? "—"}</span>
          </DescRow>
          <DescRow label={t("ilMunicipalAuthority")}>
            {business.ilMunicipalAuthority ?? "—"}
          </DescRow>
        </dl>
      </section>

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.address")}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
          <DescRow label={t("addressStreet")}>
            {business.addressStreet ?? "—"}
          </DescRow>
          <DescRow label={t("addressCity")}>
            {business.addressCity ?? "—"}
          </DescRow>
          <DescRow label={t("addressPostalCode")}>
            <span dir="ltr">{business.addressPostalCode ?? "—"}</span>
          </DescRow>
          <DescRow label={t("addressCountry")}>
            <span dir="ltr">{business.addressCountry}</span>
          </DescRow>
        </dl>
      </section>

      <section className="glass-strong overflow-hidden rounded-2xl">
        <h2 className="px-6 pt-6 text-sm font-medium tracking-tight text-slate-200">
          {t("detail.vatHistory")}
        </h2>
        {history.length === 0 ? (
          <p className="px-6 pb-6 pt-2 text-sm text-slate-500">
            {t("detail.vatHistoryEmpty")}
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <th className="px-6 py-3 text-start">{t("entityType")}</th>
                <th className="px-6 py-3 text-start">{t("vatStatus")}</th>
                <th className="px-6 py-3 text-start">
                  {t("detail.effectiveFrom")}
                </th>
                <th className="px-6 py-3 text-start">
                  {t("detail.effectiveTo")}
                </th>
                <th className="px-6 py-3 text-start">{t("detail.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr
                  key={h.id}
                  className="border-b border-white/5 last:border-b-0"
                >
                  <td className="px-6 py-3 text-slate-200">
                    {t(`entityOption.${h.entityType}`)}
                  </td>
                  <td className="px-6 py-3 text-slate-200">
                    {t(`vatStatusOption.${h.vatStatus}`)}
                  </td>
                  <td className="px-6 py-3 text-slate-300" dir="ltr">
                    {h.effectiveFrom}
                  </td>
                  <td className="px-6 py-3 text-slate-300" dir="ltr">
                    {h.effectiveTo ?? "—"}
                  </td>
                  <td className="px-6 py-3 text-slate-400">
                    {h.reason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function DescRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-slate-200">{children}</dd>
    </div>
  );
}
