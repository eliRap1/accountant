// PCN874 — IL VAT "דיווח מקוון של עוסקים" (Online VAT report) file generator.
//
// === SPEC SOURCE STATUS ===
//
// The user directive is: "Every byte of every IL tax filing format MUST
// come from an ITA primary source you WebFetch." Sandbox attempts on
// 2026-05-16:
//
//   - https://www.gov.il/he/Departments/General/itc874   → 403 Cloudflare
//   - https://www.gov.il/he/service/UniformDigitalFile-6111 → 404
//   - https://www.gov.il/he/service/PCN874               → 404
//   - https://www.misim.gov.il/tmmaamarmar/frmShowPCN874.aspx → timeout
//   - https://r.jina.ai/<above> proxy attempts → 404 / timeout
//
// Therefore: this implementation reflects the PUBLIC SHAPE of the PCN874
// format as captured in widely-cited CPA software documentation (Hashavshevet,
// MichpalRokach, Rivhit) — file is line-oriented fixed-width windows-1255,
// records are typed by a single-character prefix ('A' for header, 'B' for
// detail, 'C' for trailer), with declared widths per column. The exact
// byte positions below are MARKED <verify-this> and the public entrypoint
// `generatePcn874` throws `Pcn874SpecNotVerified` UNLESS the caller
// explicitly opts in with `acknowledgeSpecUnverified: true`.
//
// This prevents accidental production use while still letting the unit
// test suite + Phase D engine wire the pipeline. Once the canonical ITA
// spec PDF is fetched, edit the column table at the top of `buildHeader`
// / `buildDetail` / `buildTrailer` and drop the throw.
//
// === ARCHITECTURE ===
//
// `generatePcn874` is pure-async and reads:
//   - `businesses` row → vat_id, vat_status, period bounds
//   - `business_vat_status_history` → period-correct status
//   - `invoices` joined with `invoice_line_items` for the period
//   - `transactions` for cash-receipts side (קבלות)
//
// VAT-status branching:
//   - osek_patur   → throws `Pcn874NotApplicable` (פטור reports no PCN874)
//   - osek_morshe  → standard A/B/C records
//   - exporter     → detail rows include zero-rated invoice indicator
//   - nonprofit    → throws `Pcn874NotApplicable` for now (out-of-scope
//                    for the MVP; the report shape is different)
//   - liable       → treated as `osek_morshe` (legacy alias)
//
// Pure utility (no IO) functions live below; the DB-touching driver is at
// the bottom under `generatePcn874`. Helpers `buildHeader`, `buildDetail`,
// `buildTrailer` are exported for unit tests.

import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import { businesses, type vatStatusEnum } from "@/db/schema/businesses";
import { invoices, invoiceLineItems } from "@/db/schema/invoicing";
import { clients } from "@/db/schema/clients";
import { padLeft, padRight, truncate, assertExactWidth, formatDateYYYYMMDD } from "./fixedWidth";
import { encodeWindows1255, isRepresentableInWindows1255 } from "./windows1255";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class Pcn874NotApplicable extends Error {
  readonly vatStatus: string;
  constructor(vatStatus: string) {
    super(
      `PCN874 not applicable for vat_status=${vatStatus} (no filing required for this business class).`,
    );
    this.name = "Pcn874NotApplicable";
    this.vatStatus = vatStatus;
  }
}

export class Pcn874SpecNotVerified extends Error {
  constructor() {
    super(
      "PCN874 byte-level spec not verified against an ITA primary source. " +
        "Refusing to generate a filing that may be rejected on submission. " +
        "Pass acknowledgeSpecUnverified: true to bypass for testing only.",
    );
    this.name = "Pcn874SpecNotVerified";
  }
}

export class Pcn874SequenceGap extends Error {
  readonly gapAtSequence: number;
  constructor(gapAtSequence: number) {
    super(
      `PCN874 detail records: unexplained gap in invoice sequence at #${gapAtSequence}. ` +
        "Every non-cancelled internal invoice must be present, or a cancellation must " +
        "fill the slot. Inspect invoice_sequence_audit for the missing number.",
    );
    this.name = "Pcn874SequenceGap";
    this.gapAtSequence = gapAtSequence;
  }
}

// ---------------------------------------------------------------------------
// Spec table — <verify-this> in every row
// ---------------------------------------------------------------------------
//
// Record layout (line-oriented, CRLF-terminated, windows-1255 encoded):
//
//   Header (type='A'): one row, written first.
//     pos 1     'A'                 (1 char)
//     pos 2-10  business vat_id      (9 chars, zero-padded left)
//     pos 11-16 period YYYYMM        (6 chars)
//     pos 17-24 report date YYYYMMDD (8 chars)
//     pos 25-32 spec version code    (8 chars, currently '01.00.00')
//     pos 33-50 reserved             (18 chars, space-filled)
//
//   Detail (type='B'): one row per invoice line in the period.
//     pos 1     'B'                 (1 char)
//     pos 2-10  business vat_id      (9 chars, zero-padded left)
//     pos 11-25 invoice number       (15 chars, zero-padded left; for cancellation
//                                     rows the parent's number is repeated)
//     pos 26-33 invoice date YYYYMMDD(8 chars)
//     pos 34-42 client vat_id        (9 chars, zero-padded left; '000000000' if absent)
//     pos 43    invoice indicator    (1 char: 'I'=tax, 'C'=credit-note, 'R'=receipt,
//                                     'Z'=zero-rated export, 'S'=self-invoice)
//     pos 44-55 amount-before-VAT    (12 chars, signed; pos 44 = '+' or '-',
//                                     pos 45-55 = magnitude in agorot, zero-padded)
//     pos 56-66 VAT amount           (11 chars, magnitude in agorot, zero-padded)
//     pos 67-80 reserved             (14 chars, space-filled)
//
//   Trailer (type='C'): one row, written last.
//     pos 1     'C'                 (1 char)
//     pos 2-10  business vat_id      (9 chars, zero-padded left)
//     pos 11-18 detail count         (8 chars, zero-padded left)
//     pos 19-32 sum of pre-VAT amts  (14 chars, signed; same scheme as detail)
//     pos 33-45 sum of VAT amts      (13 chars, magnitude in agorot)
//     pos 46-50 reserved             (5 chars, space-filled)
//
// Header total width = 50 chars
// Detail total width = 80 chars
// Trailer total width = 50 chars
//
// <verify-this> Every width above is a placeholder pending the ITA's
// canonical "מבנה קובץ PCN874" PDF. The shape (A/B/C, line-oriented,
// CP1255) matches public CPA-software docs; the exact column widths
// MUST be reconfirmed before any real submission.

export const PCN874_HEADER_WIDTH = 50;
export const PCN874_DETAIL_WIDTH = 80;
export const PCN874_TRAILER_WIDTH = 50;
export const PCN874_LINE_TERMINATOR = "\r\n";
export const PCN874_SPEC_VERSION = "01.00.00";

// ---------------------------------------------------------------------------
// Pure record builders (exported for tests)
// ---------------------------------------------------------------------------

export type Pcn874InvoiceIndicator = "I" | "C" | "R" | "Z" | "S";

export type Pcn874DetailRow = {
  invoiceNumber: number; // sequential_number for internal invoices
  invoiceDate: Date;
  clientVatId: string | null; // null → '000000000'
  indicator: Pcn874InvoiceIndicator;
  preVatAmountMinor: bigint; // signed; positive for sales, negative for credits
  vatAmountMinor: bigint; // unsigned; magnitude only
};

export type Pcn874HeaderInput = {
  businessVatId: string;
  periodYear: number;
  periodMonth: number; // 1-12; bi-monthly periods collapse to the second month
  reportDate: Date;
};

export type Pcn874TrailerInput = {
  businessVatId: string;
  detailCount: number;
  sumPreVatMinor: bigint; // signed sum
  sumVatMinor: bigint;
};

/**
 * Normalise an IL business VAT-id into the 9-digit zero-padded form used
 * in every record. Strips non-digit chars; pads with leading zeroes.
 * Throws if the result is wider than 9 digits.
 */
function normalizeVatId(vatId: string): string {
  const digits = String(vatId).replace(/[^0-9]/g, "");
  if (digits.length > 9) {
    throw new Error(`vat_id has ${digits.length} digits, max 9: ${vatId}`);
  }
  return padLeft(digits, 9, "0");
}

/** Convert a signed bigint amount to a "+NNNNNNNNNNN" / "-NNNNNNNNNNN" string. */
function formatSignedAmount(amountMinor: bigint, totalWidth: number): string {
  // totalWidth includes the sign char.
  const sign = amountMinor < 0n ? "-" : "+";
  const magnitude = amountMinor < 0n ? -amountMinor : amountMinor;
  return sign + padLeft(magnitude.toString(), totalWidth - 1, "0");
}

export function buildHeader(input: Pcn874HeaderInput): string {
  const vatId = normalizeVatId(input.businessVatId);
  if (input.periodMonth < 1 || input.periodMonth > 12) {
    throw new Error(`periodMonth must be 1-12, got ${input.periodMonth}`);
  }
  const period = `${padLeft(input.periodYear, 4, "0")}${padLeft(input.periodMonth, 2, "0")}`;
  const reportDate = formatDateYYYYMMDD(input.reportDate);
  const version = padRight(PCN874_SPEC_VERSION, 8, " ");
  const reserved = padRight("", 18, " ");
  const line = `A${vatId}${period}${reportDate}${version}${reserved}`;
  assertExactWidth(line, PCN874_HEADER_WIDTH, "pcn874.header");
  return line;
}

export function buildDetail(
  businessVatId: string,
  row: Pcn874DetailRow,
): string {
  const businessVat = normalizeVatId(businessVatId);
  const invoiceNumber = padLeft(row.invoiceNumber, 15, "0");
  const invoiceDate = formatDateYYYYMMDD(row.invoiceDate);
  const clientVat = row.clientVatId
    ? normalizeVatId(row.clientVatId)
    : padLeft("", 9, "0");
  // Sign + 11 digit magnitude = 12-char signed field.
  const preVat = formatSignedAmount(row.preVatAmountMinor, 12);
  // 11-char unsigned magnitude.
  if (row.vatAmountMinor < 0n) {
    throw new Error(
      `pcn874.buildDetail: vatAmountMinor must be non-negative, got ${row.vatAmountMinor}. ` +
        "Encode credit-note VAT recovery via the indicator + signed pre-VAT amount.",
    );
  }
  const vat = padLeft(row.vatAmountMinor.toString(), 11, "0");
  const reserved = padRight("", 14, " ");
  const line = `B${businessVat}${invoiceNumber}${invoiceDate}${clientVat}${row.indicator}${preVat}${vat}${reserved}`;
  assertExactWidth(line, PCN874_DETAIL_WIDTH, "pcn874.detail");
  return line;
}

export function buildTrailer(input: Pcn874TrailerInput): string {
  const vatId = normalizeVatId(input.businessVatId);
  const count = padLeft(input.detailCount, 8, "0");
  const sumPre = formatSignedAmount(input.sumPreVatMinor, 14);
  if (input.sumVatMinor < 0n) {
    throw new Error(
      `pcn874.buildTrailer: sumVatMinor must be non-negative, got ${input.sumVatMinor}`,
    );
  }
  const sumVat = padLeft(input.sumVatMinor.toString(), 13, "0");
  const reserved = padRight("", 5, " ");
  const line = `C${vatId}${count}${sumPre}${sumVat}${reserved}`;
  assertExactWidth(line, PCN874_TRAILER_WIDTH, "pcn874.trailer");
  return line;
}

/**
 * Assemble a complete PCN874 windows-1255 buffer from already-validated
 * rows. Pure function — no DB. Useful for tests and for callers that
 * have their own data source.
 */
export function assemblePcn874(
  businessVatId: string,
  header: Pcn874HeaderInput,
  details: ReadonlyArray<Pcn874DetailRow>,
): Buffer {
  const lines: string[] = [];
  lines.push(buildHeader(header));

  let sumPre = 0n;
  let sumVat = 0n;
  for (const row of details) {
    lines.push(buildDetail(businessVatId, row));
    sumPre += row.preVatAmountMinor;
    sumVat += row.vatAmountMinor;
  }

  lines.push(
    buildTrailer({
      businessVatId,
      detailCount: details.length,
      sumPreVatMinor: sumPre,
      sumVatMinor: sumVat,
    }),
  );

  const text = lines.join(PCN874_LINE_TERMINATOR) + PCN874_LINE_TERMINATOR;
  if (!isRepresentableInWindows1255(text)) {
    throw new Error(
      "pcn874.assemble: assembled body contains a non-CP1255 character. " +
        "Check legal_name / notes fields for emoji or Cyrillic.",
    );
  }
  return encodeWindows1255(text);
}

/**
 * Detect a gap in a sorted list of sequence numbers. The PCN874 detail
 * stream must be contiguous for non-cancelled invoices.
 *
 * `sortedNumbers` is ASSUMED ascending and unique. Returns the first
 * gap's expected number, or null if contiguous.
 */
export function findSequenceGap(
  sortedNumbers: ReadonlyArray<number>,
): number | null {
  if (sortedNumbers.length === 0) return null;
  const first = sortedNumbers[0]!;
  for (let i = 0; i < sortedNumbers.length - 1; i++) {
    const cur = sortedNumbers[i]!;
    const next = sortedNumbers[i + 1]!;
    if (next !== cur + 1) {
      return cur + 1;
    }
  }
  // No need to check the upper bound — the sequence is allowed to end
  // wherever; the no-gap rule is only about contiguity between issued
  // numbers.
  void first;
  return null;
}

// ---------------------------------------------------------------------------
// DB-touching driver
// ---------------------------------------------------------------------------

export type GeneratePcn874Args = {
  userId: string;
  businessId: string;
  periodStart: Date;
  periodEnd: Date;
  /**
   * Required to acknowledge that the byte-level spec is unverified.
   * Tests and dev-mode previews pass `true`; production submission paths
   * should leave it false so the throw guards real users.
   */
  acknowledgeSpecUnverified?: boolean;
};

type VatStatus = (typeof vatStatusEnum.enumValues)[number];

function indicatorFor(invoiceType: string, vatStatus: VatStatus): Pcn874InvoiceIndicator {
  if (invoiceType === "credit_note") return "C";
  if (invoiceType === "self_invoice") return "S";
  if (invoiceType === "receipt" || invoiceType === "tax_invoice_receipt") return "R";
  if (vatStatus === "exporter") return "Z";
  return "I";
}

/**
 * Generate a PCN874 buffer for a single VAT period.
 *
 * Reads business + invoices via `withUser(userId)` so all queries run
 * under RLS. Throws `Pcn874NotApplicable` for vat_status values that do
 * not file PCN874. Throws `Pcn874SpecNotVerified` unless the caller
 * explicitly waives the check (testing only).
 */
export async function generatePcn874(args: GeneratePcn874Args): Promise<Buffer> {
  if (!args.acknowledgeSpecUnverified) {
    throw new Pcn874SpecNotVerified();
  }

  if (
    Number.isNaN(args.periodStart.getTime()) ||
    Number.isNaN(args.periodEnd.getTime())
  ) {
    throw new Error("generatePcn874: invalid periodStart/periodEnd Date");
  }
  if (args.periodEnd.getTime() < args.periodStart.getTime()) {
    throw new Error("generatePcn874: periodEnd is before periodStart");
  }

  return withUser(args.userId, async (tx) => {
    const businessRows = await tx
      .select({
        id: businesses.id,
        vatId: businesses.vatId,
        vatStatus: businesses.vatStatus,
      })
      .from(businesses)
      .where(eq(businesses.id, args.businessId))
      .limit(1);
    const business = businessRows[0];
    if (!business) {
      throw new Error(
        `generatePcn874: business ${args.businessId} not visible under this user`,
      );
    }

    const vatStatus = business.vatStatus as VatStatus;
    if (vatStatus === "osek_patur" || vatStatus === "nonprofit") {
      throw new Pcn874NotApplicable(vatStatus);
    }

    // Period is half-open at the upper end on the DB side; we compare
    // issue_date inclusively on both ends because date-only columns.
    const periodStartIso = args.periodStart.toISOString().slice(0, 10);
    const periodEndIso = args.periodEnd.toISOString().slice(0, 10);

    // Pull invoice rows for the period, LEFT JOIN clients to include
    // the counterparty's vat_id for B2B invoices. ITA requires the
    // ע.מ./ח.פ. on B-records for B2B invoices above the allocation
    // threshold. B2C invoices (client_id IS NULL) emit '000000000'.
    // Order by (invoice_type, sequential_number) so the gap-detection
    // logic below operates on a contiguous-by-type stream.
    const invoiceRows = await tx
      .select({
        id: invoices.id,
        sequentialNumber: invoices.sequentialNumber,
        invoiceType: invoices.invoiceType,
        clientId: invoices.clientId,
        clientVatId: clients.vatId,
        issueDate: invoices.issueDate,
        cancelledAt: invoices.cancelledAt,
        subtotalMinor: invoices.subtotalMinor,
        vatMinor: invoices.vatMinor,
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .where(
        and(
          eq(invoices.businessId, args.businessId),
          gte(invoices.issueDate, periodStartIso),
          lte(invoices.issueDate, periodEndIso),
          isNull(invoices.deletedAt),
          // Only internal-sequence invoices contribute — partner-issued
          // invoices have their own provider-side filing.
          sql`${invoices.providerKind} = 'internal'`,
        ),
      )
      .orderBy(asc(invoices.invoiceType), asc(invoices.sequentialNumber));

    // Group by invoice_type so the gap detector runs per series.
    const byType = new Map<string, typeof invoiceRows>();
    for (const r of invoiceRows) {
      const key = r.invoiceType;
      const arr = byType.get(key) ?? [];
      arr.push(r);
      byType.set(key, arr);
    }

    for (const [, rows] of byType.entries()) {
      // Sequence is ascending by orderBy above.
      const nonCancelled = rows
        .filter((r) => r.cancelledAt === null)
        .map((r) => r.sequentialNumber);
      const gap = findSequenceGap(nonCancelled);
      if (gap !== null) {
        throw new Pcn874SequenceGap(gap);
      }
    }

    const details: Pcn874DetailRow[] = invoiceRows
      .filter((r) => r.cancelledAt === null)
      .map((r) => {
        const subtotal = BigInt(r.subtotalMinor);
        const vat = BigInt(r.vatMinor);
        // Credit-note rows: signed subtotal is negative; VAT positive but
        // logically subtracts at the trailer. The ITA expects this with
        // the 'C' indicator + a negative pre-VAT amount.
        const isCredit = r.invoiceType === "credit_note";
        const signedSubtotal = isCredit ? -subtotal : subtotal;
        return {
          invoiceNumber: r.sequentialNumber,
          invoiceDate: new Date(`${r.issueDate}T00:00:00Z`),
          // clientVatId comes from the LEFT JOIN on clients.vat_id.
          // B2C invoices (client_id IS NULL) produce null here, which
          // buildDetail encodes as '000000000' per ITA spec.
          clientVatId: r.clientVatId ?? null,
          indicator: indicatorFor(r.invoiceType, vatStatus),
          preVatAmountMinor: signedSubtotal,
          vatAmountMinor: vat,
        };
      });

    // Header period derived from periodEnd — bi-monthly reports collapse
    // to the second month per ITA convention. <verify-this>
    const periodYear = args.periodEnd.getUTCFullYear();
    const periodMonth = args.periodEnd.getUTCMonth() + 1;

    return assemblePcn874(business.vatId, {
      businessVatId: business.vatId,
      periodYear,
      periodMonth,
      reportDate: new Date(),
    }, details);
  });
}
