import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import ClientList, { type ClientRow } from "./ClientList";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.clients" });
  return { title: t("metaTitle") };
}

export default async function ClientsPage() {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.clients");

  const rows = (await withUser(me.appUserId, async (tx) => {
    return (await tx.execute(
      sql`SELECT c.id, c.legal_name AS "legalName", c.vat_id AS "vatId",
                 c.email_ciphertext AS "emailCiphertext",
                 c.phone_ciphertext AS "phoneCiphertext",
                 c.default_payment_terms_days AS "defaultPaymentTermsDays",
                 c.default_currency AS "defaultCurrency",
                 c.business_id AS "businessId",
                 b.legal_name AS "businessName"
          FROM clients c
          JOIN businesses b ON b.id = c.business_id
          WHERE c.deleted_at IS NULL
          ORDER BY c.legal_name ASC`,
    )) as unknown as ClientRow[];
  })) as ClientRow[];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          {t("addCta")}
        </Link>
      </header>
      <ClientList rows={rows} />
    </div>
  );
}
