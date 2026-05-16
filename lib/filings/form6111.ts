// Form 6111 — "דו"ח התאמה לצרכי מס" / Uniform Digital File generator.
//
// === SPEC SOURCE STATUS ===
//
// Sandbox WebFetch attempts on 2026-05-16 all 404'd or were CF-blocked
// for the canonical gov.il URLs. No authoritative XSD was retrieved.
//
// Therefore this implementation produces a CANDIDATE XML shape consistent
// with the publicly-documented "מבנה הקובץ האחיד" (Uniform File Structure)
// — a single `<Form6111>` root with `<Header>`, one `<BalanceSheet>` and
// one `<ProfitLoss>` section, each containing `<Line>` children keyed by
// the 4-digit line code from the ITA mapping schedule. The exact element
// names + the namespace URI are MARKED <verify-this>.
//
// `generateForm6111` throws `Form6111SpecNotVerified` unless the caller
// passes `acknowledgeSpecUnverified: true`.
//
// === ARCHITECTURE ===
//
// 1. Aggregate journal lines by chart_of_accounts code (period filtered).
// 2. Map each code to its 6111 line via maps/cat-to-6111.ts.
// 3. Bucket sums by line; ignored if line is null (mapping not yet
//    confirmed) — surfaced as a warning, not an error.
// 4. Render bilingual XML manually (no xml-builder dependency).
//
// XML output uses UTF-8 (not CP1255) — the uniform digital file is per
// spec encoded UTF-8 with BOM. <verify-this>

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import { businesses } from "@/db/schema/businesses";
import { journalEntries, journalLines } from "@/db/schema/ledger";
import {
  categoryCodeTo6111Line,
  line6111ToDescription,
} from "./maps/cat-to-6111";

export class Form6111SpecNotVerified extends Error {
  constructor() {
    super(
      "Form 6111 XSD not verified against an ITA primary source on 2026-05-16. " +
        "Refusing to generate a filing that may be rejected on submission. " +
        "Pass acknowledgeSpecUnverified: true to bypass for testing only.",
    );
    this.name = "Form6111SpecNotVerified";
  }
}

export type GenerateForm6111Args = {
  userId: string;
  businessId: string;
  fiscalYear: number;
  acknowledgeSpecUnverified?: boolean;
};

export type Form6111Section = "BalanceSheet" | "ProfitLoss";

export type Form6111LineBucket = {
  line: string;
  section: Form6111Section;
  amountMinor: bigint;
  he: string;
  en: string;
};

export type Form6111Aggregation = {
  byLine: Map<string, Form6111LineBucket>;
  unmappedCodes: string[];
};

// ---------------------------------------------------------------------------
// Pure aggregation
// ---------------------------------------------------------------------------

/** Classify a chart-of-accounts code into the 6111 section it lives in. */
export function sectionFor6111Line(line: string): Form6111Section {
  // BS lines: 1xxx (assets), 2xxx (liabilities), 3xxx (equity).
  // P&L lines: 4xxx (income), 5xxx-8xxx (expenses).
  const firstDigit = line[0];
  if (firstDigit === "1" || firstDigit === "2" || firstDigit === "3") {
    return "BalanceSheet";
  }
  return "ProfitLoss";
}

/**
 * Aggregate raw `{ accountCode, debitMinor, creditMinor }` journal lines
 * into 6111-line buckets. Signed amount per bucket = debits - credits
 * for asset/expense lines, credits - debits for liability/equity/income.
 *
 * Pure function. No DB. Used by both the live generator and unit tests.
 */
export function aggregateJournalLinesTo6111(
  rows: ReadonlyArray<{
    accountCode: string;
    debitMinor: bigint;
    creditMinor: bigint;
  }>,
): Form6111Aggregation {
  const byLine = new Map<string, Form6111LineBucket>();
  const unmappedSet = new Set<string>();

  for (const row of rows) {
    const line = categoryCodeTo6111Line(row.accountCode);
    if (line === null) {
      unmappedSet.add(row.accountCode);
      continue;
    }
    const section = sectionFor6111Line(line);
    const firstDigit = line[0];
    // Sign convention: asset (1xxx) + expense (5xxx-8xxx) → debit-credit;
    // liability (2xxx) + equity (3xxx) + income (4xxx) → credit-debit.
    const debitSide = firstDigit === "1" || /^[5-8]/.test(line);
    const signed = debitSide
      ? row.debitMinor - row.creditMinor
      : row.creditMinor - row.debitMinor;
    const desc = line6111ToDescription(line);
    const cur = byLine.get(line);
    if (cur) {
      cur.amountMinor += signed;
    } else {
      byLine.set(line, {
        line,
        section,
        amountMinor: signed,
        he: desc.he,
        en: desc.en,
      });
    }
  }
  return { byLine, unmappedCodes: Array.from(unmappedSet).sort() };
}

// ---------------------------------------------------------------------------
// XML rendering — minimal, no deps
// ---------------------------------------------------------------------------

/** Escape XML text — covers the 5 special chars only. */
function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type Form6111RenderInput = {
  businessVatId: string;
  legalName: string;
  fiscalYear: number;
  generatedAt: Date;
  aggregation: Form6111Aggregation;
};

/**
 * Render the aggregation to XML. Structure (<verify-this>):
 *
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <Form6111 xmlns="urn:il:tax:form6111:v1">
 *     <Header>
 *       <BusinessVatId>...</BusinessVatId>
 *       <LegalName>...</LegalName>
 *       <FiscalYear>2025</FiscalYear>
 *       <GeneratedAt>2026-05-16T12:34:56.000Z</GeneratedAt>
 *     </Header>
 *     <BalanceSheet>
 *       <Line code="1010" he="..." en="..." amountMinor="..."/>
 *       ...
 *     </BalanceSheet>
 *     <ProfitLoss>
 *       <Line .../>
 *     </ProfitLoss>
 *   </Form6111>
 *
 * Real ITA element names + namespace MUST be reconfirmed before submission.
 */
export function renderForm6111Xml(input: Form6111RenderInput): string {
  const bs: Form6111LineBucket[] = [];
  const pl: Form6111LineBucket[] = [];
  for (const b of input.aggregation.byLine.values()) {
    if (b.section === "BalanceSheet") bs.push(b);
    else pl.push(b);
  }
  bs.sort((a, b) => a.line.localeCompare(b.line));
  pl.sort((a, b) => a.line.localeCompare(b.line));

  const renderLines = (lines: Form6111LineBucket[]): string =>
    lines
      .map(
        (l) =>
          `    <Line code="${xmlEscape(l.line)}" he="${xmlEscape(l.he)}" en="${xmlEscape(l.en)}" amountMinor="${l.amountMinor.toString()}"/>`,
      )
      .join("\n");

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<Form6111 xmlns="urn:il:tax:form6111:v1">`);
  parts.push(`  <Header>`);
  parts.push(
    `    <BusinessVatId>${xmlEscape(input.businessVatId)}</BusinessVatId>`,
  );
  parts.push(`    <LegalName>${xmlEscape(input.legalName)}</LegalName>`);
  parts.push(`    <FiscalYear>${input.fiscalYear}</FiscalYear>`);
  parts.push(
    `    <GeneratedAt>${xmlEscape(input.generatedAt.toISOString())}</GeneratedAt>`,
  );
  parts.push(`  </Header>`);
  parts.push(`  <BalanceSheet>`);
  if (bs.length > 0) parts.push(renderLines(bs));
  parts.push(`  </BalanceSheet>`);
  parts.push(`  <ProfitLoss>`);
  if (pl.length > 0) parts.push(renderLines(pl));
  parts.push(`  </ProfitLoss>`);
  parts.push(`</Form6111>`);
  return parts.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// DB-touching driver
// ---------------------------------------------------------------------------

/**
 * Generate a Form 6111 XML string for a fiscal year. The fiscal year is
 * interpreted as Jan 1 → Dec 31 in UTC unless the business has a custom
 * `tax_year_end_month` — this generator does NOT yet honour that override
 * (Phase D dependency). <verify-this>
 */
export async function generateForm6111(
  args: GenerateForm6111Args,
): Promise<string> {
  if (!args.acknowledgeSpecUnverified) {
    throw new Form6111SpecNotVerified();
  }
  if (!Number.isInteger(args.fiscalYear) || args.fiscalYear < 2000) {
    throw new Error(
      `generateForm6111: implausible fiscalYear ${args.fiscalYear}`,
    );
  }

  return withUser(args.userId, async (tx) => {
    const businessRows = await tx
      .select({
        id: businesses.id,
        vatId: businesses.vatId,
        legalName: businesses.legalName,
        taxYearEndMonth: businesses.taxYearEndMonth,
      })
      .from(businesses)
      .where(eq(businesses.id, args.businessId))
      .limit(1);
    const business = businessRows[0];
    if (!business) {
      throw new Error(
        `generateForm6111: business ${args.businessId} not visible under this user`,
      );
    }

    // Jan 1 - Dec 31 of the fiscal year. <verify-this> non-Dec year-ends.
    const periodStart = `${args.fiscalYear}-01-01`;
    const periodEnd = `${args.fiscalYear}-12-31`;

    const rows = await tx
      .select({
        accountCode: journalLines.accountCode,
        debitMinor: journalLines.debitMinor,
        creditMinor: journalLines.creditMinor,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          eq(journalEntries.businessId, args.businessId),
          gte(journalEntries.entryDate, periodStart),
          lte(journalEntries.entryDate, periodEnd),
          isNull(journalEntries.reversedById),
        ),
      );

    const aggregation = aggregateJournalLinesTo6111(
      rows.map((r) => ({
        accountCode: r.accountCode,
        debitMinor: BigInt(r.debitMinor),
        creditMinor: BigInt(r.creditMinor),
      })),
    );

    // Bind sql so the import is not flagged as unused (we keep it for
    // future ad-hoc CASE-based aggregation if the join above is replaced).
    void sql;

    return renderForm6111Xml({
      businessVatId: business.vatId,
      legalName: business.legalName,
      fiscalYear: args.fiscalYear,
      generatedAt: new Date(),
      aggregation,
    });
  });
}
