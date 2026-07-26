import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import BusinessForm, { type BusinessFormValues } from "../../BusinessForm";

type Props = { params: Promise<{ id: string; locale: string }> };

type Row = {
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

export default async function EditBusinessPage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();

  const row = await withUser(me.appUserId, async (tx) => {
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
    )) as unknown as Row[];
    return rows[0] ?? null;
  });

  if (!row) notFound();

  const initial: Partial<BusinessFormValues> = {
    id: row.id,
    legalName: row.legalName,
    vatId: row.vatId,
    entityType: row.entityType,
    vatStatus: row.vatStatus,
    bookkeepingMethod: row.bookkeepingMethod,
    taxYearEndMonth: row.taxYearEndMonth,
    advanceTaxRatePct: row.advanceTaxRatePct ?? "",
    tikNikuyim: row.tikNikuyim ?? "",
    defaultCurrency: row.defaultCurrency,
    addressStreet: row.addressStreet ?? "",
    addressCity: row.addressCity ?? "",
    addressPostalCode: row.addressPostalCode ?? "",
    addressCountry: row.addressCountry,
    ilMunicipalAuthority: row.ilMunicipalAuthority ?? "",
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <BusinessForm mode="edit" initial={initial} />
    </div>
  );
}
