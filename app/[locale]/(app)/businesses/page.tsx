import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import BusinessList, { type BusinessRow } from "./BusinessList";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.businesses" });
  return { title: t("metaTitle") };
}

export default async function BusinessesPage(_props: Props) {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.businesses");

  const rows = (await withUser(me.appUserId, async (tx) => {
    return (await tx.execute(
      sql`SELECT id, legal_name AS "legalName", vat_id AS "vatId",
                 entity_type AS "entityType", vat_status AS "vatStatus",
                 bookkeeping_method AS "bookkeepingMethod",
                 default_currency AS "defaultCurrency",
                 deleted_at AS "deletedAt",
                 created_at AS "createdAt"
          FROM businesses
          WHERE owner_user_id = ${me.appUserId}::uuid
            AND deleted_at IS NULL
          ORDER BY legal_name ASC`,
    )) as unknown as BusinessRow[];
  })) as BusinessRow[];

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
          href="/businesses/new"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          {t("addCta")}
        </Link>
      </header>
      <BusinessList rows={rows} />
    </div>
  );
}
