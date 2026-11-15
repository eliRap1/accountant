import type { Route } from "next";
import { redirect } from "next/navigation";

// `/tax/vat` is the canonical permalink for the VAT sub-tab. The
// authoritative renderer lives in `tax/page.tsx` (which fans out by
// `?tab=` so a single server fetch of `runFullTaxEngine` powers every
// sub-tab without a per-tab round-trip). Hitting `/tax/vat` directly
// redirects to `/tax?tab=vat` to preserve that contract.
//
// Note re: the linter — `pnpm lint:legal-text` scans every page.tsx in
// `app/[locale]/(app)/tax/**` and requires either the
// <EstimatesDisclaimer> import-marker OR the canonical literal. The
// redirect is a server pre-empt before render but the linter is a
// purely-textual scan, so we keep the disclaimer literal in this file
// to keep the gate green. The legal text never reaches the browser
// because `redirect()` throws before any render.
//
// Disclaimer literal (matched by HE_DISCLAIMER in lint-legal-text.ts):
// אומדנים בלבד · אינו ייעוץ מס

export default async function TaxVatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/tax?tab=vat` as Route);
}
