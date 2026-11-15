// Leumi PDF parser (Plan v4 Phase F.2).
//
// <verify-this> Leumi does NOT publish a stable export schema. The
// statement PDFs are layout-driven (positioned text frames) and the
// column order has historically been:
//   1. תאריך (Date — DD/MM/YYYY)
//   2. תאריך ערך (Value date — DD/MM/YYYY, sometimes blank)
//   3. תיאור (Description — Hebrew/English)
//   4. אסמכתא (Reference number)
//   5. חובה (Debit — major-unit ILS with thousands separator)
//   6. זכות (Credit — major-unit ILS with thousands separator)
//   7. יתרה (Balance — major-unit ILS)
// Confirm against a real "Leumi Digital → דפי חשבון → ייצוא PDF" before
// trusting amounts at commit time.
//
// This file ships as a STUB because we do not have `pdf-parse` installed
// (Plan v4 budget: no new deps unless strictly needed). The stub:
//   1. Detects the buffer is a PDF (`%PDF-` magic).
//   2. Surfaces a single warning row so the operator knows the import
//      went through dispatcher correctly.
//   3. Returns an empty rows array so the UI shows the "no rows parsed
//      — install pdf-parse to enable Leumi PDF" empty state.
// Once we accept the dep, swap the body for a real layout-walker.

import type { ParsedTransactions } from "./index";

const PDF_MAGIC = Buffer.from("%PDF-");

export async function parseLeumiPdf(
  buffer: Buffer,
): Promise<ParsedTransactions> {
  const warnings: string[] = [];
  const looksLikePdf =
    buffer.length >= PDF_MAGIC.length &&
    buffer.slice(0, PDF_MAGIC.length).equals(PDF_MAGIC);
  if (!looksLikePdf) {
    warnings.push(
      "leumi_pdf: buffer is not a PDF (missing %PDF- magic). Are you sure the file is a Leumi statement?",
    );
    return { rows: [], warnings };
  }
  warnings.push(
    "leumi_pdf: parser is stubbed — install `pdf-parse` and implement the layout walker. <verify-this:leumi-pdf-schema>",
  );
  // <verify-this:leumi-pdf-schema>
  return { rows: [], warnings };
}
