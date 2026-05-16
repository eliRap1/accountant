import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import ClientForm, {
  type BusinessOption,
  type ClientFormValues,
} from "../../ClientForm";

type Props = { params: Promise<{ id: string; locale: string }> };

type Row = {
  id: string;
  businessId: string;
  legalName: string;
  vatId: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  defaultPaymentTermsDays: number;
  defaultCurrency: string;
};

export default async function EditClientPage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();

  const { row, businesses } = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id, business_id AS "businessId",
                 legal_name AS "legalName", vat_id AS "vatId",
                 address_street AS "addressStreet",
                 address_city AS "addressCity",
                 address_postal_code AS "addressPostalCode",
                 address_country AS "addressCountry",
                 default_payment_terms_days AS "defaultPaymentTermsDays",
                 default_currency AS "defaultCurrency"
          FROM clients
          WHERE id = ${id}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as Row[];

    const bs = (await tx.execute(
      sql`SELECT id, legal_name AS "legalName"
          FROM businesses
          WHERE deleted_at IS NULL
          ORDER BY legal_name ASC`,
    )) as unknown as BusinessOption[];

    return { row: rows[0] ?? null, businesses: bs };
  });

  if (!row) notFound();

  // Ciphertexts intentionally never round-trip into the form — Phase C
  // wires a reveal flow with step-up auth. For now editing email/phone
  // re-encrypts the new plaintext but cannot pre-populate the prior value.
  const initial: Partial<ClientFormValues> = {
    id: row.id,
    businessId: row.businessId,
    legalName: row.legalName,
    vatId: row.vatId ?? "",
    email: "",
    phone: "",
    notes: "",
    addressStreet: row.addressStreet ?? "",
    addressCity: row.addressCity ?? "",
    addressPostalCode: row.addressPostalCode ?? "",
    addressCountry: row.addressCountry ?? "IL",
    defaultPaymentTermsDays: row.defaultPaymentTermsDays,
    defaultCurrency: row.defaultCurrency,
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <ClientForm mode="edit" businesses={businesses} initial={initial} />
    </div>
  );
}
