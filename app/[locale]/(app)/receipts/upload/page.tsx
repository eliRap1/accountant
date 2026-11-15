import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import ReceiptUploadDropzone from "../ReceiptUploadDropzone";

type SearchParams = Promise<{ businessId?: string }>;

type BusinessOption = { id: string; legalName: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.receipts" });
  return { title: t("upload.metaTitle") };
}

export default async function ReceiptUploadPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.receipts");
  const sp = (await searchParams) ?? {};
  const defaultBusinessId = sp.businessId ?? null;

  const businesses = await withUser(me.appUserId, async (tx) => {
    return (await tx.execute(
      sql`SELECT id::text, legal_name AS "legalName"
            FROM businesses
            WHERE deleted_at IS NULL
            ORDER BY legal_name ASC`,
    )) as unknown as BusinessOption[];
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          {t("upload.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-400">{t("upload.subtitle")}</p>
      </header>

      {businesses.length === 0 ? (
        <div className="glass-strong rounded-2xl p-8 text-center">
          <p className="text-sm text-slate-300">{t("upload.noBusinesses")}</p>
        </div>
      ) : (
        <ReceiptUploadDropzone
          businesses={businesses}
          defaultBusinessId={defaultBusinessId}
        />
      )}
    </div>
  );
}
