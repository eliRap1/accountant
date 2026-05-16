import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { decryptStringWithDek } from "@/lib/security/encryption";
import ReceiptReviewForm from "../ReceiptReviewForm";

type Props = { params: Promise<{ id: string; locale: string }> };

type ReceiptHead = {
  id: string;
  businessId: string;
  businessName: string;
  status: "pending_review" | "approved" | "rejected";
  source: string;
  parsedAmountMinor: string | null;
  parsedVatMinor: string | null;
  parsedDate: string | null;
  parsedVendorCiphertext: string | null;
  ocrTextCiphertext: string | null;
  categoryCode: string | null;
  businessUsePct: string;
  fileBlobUrl: string | null;
  fileKeyId: string | null;
  linkedTransactionId: string | null;
  createdAt: string;
};

function minorToMajorString(minor: string | null): string {
  if (!minor) return "";
  const v = BigInt(minor);
  const major = v / 100n;
  const cents = v % 100n;
  return `${major.toString()}.${cents.toString().padStart(2, "0")}`;
}

async function decryptIfPresent(
  ciphertext: string | null,
  businessId: string,
  rowId: string,
  column: "parsed_vendor_ciphertext" | "ocr_text_ciphertext",
): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    // The DEK id is recovered from the v1:iv:tag:ct envelope encoded
    // inside the column? No — encryptStringWithDek embeds the dekId in
    // the `data_encryption_keys` row, not in the wire format. The
    // wire format only carries iv:tag:ct under the purpose-bound DEK.
    // We resolve via the active DEK for that purpose (Plan v4 contract:
    // each receipt encrypts with the active per-purpose DEK at write
    // time; rotation creates a new DEK row, so reads always use the
    // dekId persisted in *_key_id columns OR re-resolve via purpose).
    //
    // For receipt vendor + ocr text columns we currently lack a
    // dedicated *_key_id (the schema only has file_key_id for the
    // blob). So we re-resolve through the per-purpose lookup — which
    // is identical to encryptStringWithDek's read path semantics.
    const { getActiveDek } = await import("@/lib/security/dek");
    const purpose =
      column === "parsed_vendor_ciphertext"
        ? `business:${businessId}:receipt_vendor`
        : `business:${businessId}:receipt_ocr_text`;
    const active = await getActiveDek(purpose);
    if (!active) return null;
    return await decryptStringWithDek({
      dekId: active.dekId,
      ciphertext,
      aad: { table: "receipts", column, rowId },
    });
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.receipts" });
  return { title: t("detail.metaTitle") };
}

export default async function ReceiptDetailPage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();
  const t = await getTranslations("app.receipts");

  const head = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT r.id::text,
                 r.business_id::text AS "businessId",
                 b.legal_name AS "businessName",
                 r.status::text AS "status",
                 r.source::text AS "source",
                 r.parsed_amount_minor::text AS "parsedAmountMinor",
                 r.parsed_vat_minor::text AS "parsedVatMinor",
                 r.parsed_date::text AS "parsedDate",
                 r.parsed_vendor_ciphertext AS "parsedVendorCiphertext",
                 r.ocr_text_ciphertext AS "ocrTextCiphertext",
                 r.category_code AS "categoryCode",
                 r.business_use_pct::text AS "businessUsePct",
                 r.file_blob_url AS "fileBlobUrl",
                 r.file_key_id::text AS "fileKeyId",
                 r.linked_transaction_id::text AS "linkedTransactionId",
                 to_char(r.created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt"
            FROM receipts r
            JOIN businesses b ON b.id = r.business_id
            WHERE r.id = ${id}::uuid LIMIT 1`,
    )) as unknown as ReceiptHead[];
    return rows[0] ?? null;
  });

  if (!head) notFound();

  const vendor = await decryptIfPresent(
    head.parsedVendorCiphertext,
    head.businessId,
    head.id,
    "parsed_vendor_ciphertext",
  );
  const ocrText = await decryptIfPresent(
    head.ocrTextCiphertext,
    head.businessId,
    head.id,
    "ocr_text_ciphertext",
  );

  // The status banner colour mirrors the list-page badge classes.
  const statusBanner =
    head.status === "approved"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
      : head.status === "rejected"
        ? "border-red-400/40 bg-red-500/10 text-red-200"
        : "border-amber-400/40 bg-amber-500/10 text-amber-100";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("detail.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400" dir="ltr">
            {head.businessName} · {head.parsedDate ?? head.createdAt}
          </p>
        </div>
        <Link
          href="/receipts"
          className="inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
        >
          {t("detail.backToList")}
        </Link>
      </header>

      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${statusBanner}`}
      >
        <span>{t(`status.${head.status}`)}</span>
      </div>

      {ocrText ? (
        <section className="glass-strong rounded-2xl p-6">
          <h2 className="text-sm font-medium tracking-tight text-slate-200">
            {t("detail.ocrTextTitle")}
          </h2>
          <pre
            className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-slate-950/60 p-3 text-xs text-slate-300"
            dir="auto"
          >
            {ocrText}
          </pre>
        </section>
      ) : head.fileBlobUrl ? (
        <section className="glass-strong rounded-2xl p-6">
          <h2 className="text-sm font-medium tracking-tight text-slate-200">
            {t("detail.ocrPendingTitle")}
          </h2>
          <p className="mt-2 text-xs text-slate-500">
            {t("detail.ocrPendingDesc")}
          </p>
        </section>
      ) : null}

      <ReceiptReviewForm
        receiptId={head.id}
        initial={{
          parsedAmountMajor: minorToMajorString(head.parsedAmountMinor),
          parsedVatMajor: minorToMajorString(head.parsedVatMinor),
          parsedDate: head.parsedDate ?? "",
          parsedVendor: vendor ?? "",
          categoryCode: head.categoryCode ?? "",
          businessUsePct: head.businessUsePct,
        }}
        status={head.status}
        linkedTransactionId={head.linkedTransactionId}
        linkedInvoiceId={null}
      />
    </div>
  );
}
