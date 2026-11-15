import { sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import UploadForm from "./UploadForm";

// Upload-page server shell. Loads the operator's businesses for the
// dropdown, then hands off to the client form.

type BusinessOption = { id: string; legalName: string };

export default async function UploadPage() {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.bankImports");

  const businesses = await withUser(me.appUserId, async (tx) => {
    return (await tx.execute(
      sql`SELECT id::text AS id, legal_name AS "legalName"
            FROM businesses
           WHERE deleted_at IS NULL
           ORDER BY legal_name ASC`,
    )) as unknown as BusinessOption[];
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          {t("uploadTitle")}
        </h1>
        <p className="mt-1 text-sm text-slate-400">{t("uploadSubtitle")}</p>
      </header>
      <UploadForm businesses={businesses} />
    </div>
  );
}
