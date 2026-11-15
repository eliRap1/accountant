import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Pencil } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import SendPortalLinkButton from "../SendPortalLinkButton";

type Props = { params: Promise<{ id: string; locale: string }> };

type Row = {
  id: string;
  legalName: string;
  vatId: string | null;
  emailCiphertext: string | null;
  phoneCiphertext: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  defaultPaymentTermsDays: number;
  defaultCurrency: string;
  businessName: string;
};

export default async function ClientDetailPage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();
  const t = await getTranslations("app.clients");

  const row = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT c.id, c.legal_name AS "legalName", c.vat_id AS "vatId",
                 c.email_ciphertext AS "emailCiphertext",
                 c.phone_ciphertext AS "phoneCiphertext",
                 c.address_street AS "addressStreet",
                 c.address_city AS "addressCity",
                 c.address_postal_code AS "addressPostalCode",
                 c.address_country AS "addressCountry",
                 c.default_payment_terms_days AS "defaultPaymentTermsDays",
                 c.default_currency AS "defaultCurrency",
                 b.legal_name AS "businessName"
          FROM clients c
          JOIN businesses b ON b.id = c.business_id
          WHERE c.id = ${id}::uuid AND c.deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as Row[];
    return rows[0] ?? null;
  });

  if (!row) notFound();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {row.legalName}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{row.businessName}</p>
        </div>
        <div className="flex items-center gap-3">
          <SendPortalLinkButton
            clientId={row.id}
            labels={{
              cta: t("sendPortalLinkCta"),
              sent: t("portalLinkSent"),
              failed: t("portalLinkFailed"),
            }}
          />
          <Link
            href={`/clients/${row.id}/edit`}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
          >
            <Pencil size={14} />
            {t("col.edit")}
          </Link>
        </div>
      </header>

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.profile")}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
          <DescRow label={t("vatId")}>
            <span dir="ltr">{row.vatId ?? "—"}</span>
          </DescRow>
          <DescRow label={t("defaultPaymentTermsDays")}>
            <span dir="ltr">{row.defaultPaymentTermsDays}</span>
          </DescRow>
          <DescRow label={t("defaultCurrency")}>
            <span dir="ltr">{row.defaultCurrency}</span>
          </DescRow>
          <DescRow label={t("email")}>
            {row.emailCiphertext ? (
              <span className="text-slate-500">{t("masked")}</span>
            ) : (
              "—"
            )}
          </DescRow>
          <DescRow label={t("phone")}>
            {row.phoneCiphertext ? (
              <span className="text-slate-500">{t("masked")}</span>
            ) : (
              "—"
            )}
          </DescRow>
        </dl>
      </section>

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.address")}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
          <DescRow label={t("addressStreet")}>
            {row.addressStreet ?? "—"}
          </DescRow>
          <DescRow label={t("addressCity")}>{row.addressCity ?? "—"}</DescRow>
          <DescRow label={t("addressPostalCode")}>
            <span dir="ltr">{row.addressPostalCode ?? "—"}</span>
          </DescRow>
          <DescRow label={t("addressCountry")}>
            <span dir="ltr">{row.addressCountry ?? "—"}</span>
          </DescRow>
        </dl>
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
