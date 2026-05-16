import { describe, it, expect } from "vitest";
import {
  aggregateJournalLinesTo6111,
  sectionFor6111Line,
  renderForm6111Xml,
  generateForm6111,
  Form6111SpecNotVerified,
} from "@/lib/filings/form6111";

describe("form6111 sectionFor6111Line", () => {
  it("classifies 1xxx as BalanceSheet", () => {
    expect(sectionFor6111Line("1010")).toBe("BalanceSheet");
  });

  it("classifies 2xxx as BalanceSheet", () => {
    expect(sectionFor6111Line("2020")).toBe("BalanceSheet");
  });

  it("classifies 3xxx as BalanceSheet", () => {
    expect(sectionFor6111Line("3040")).toBe("BalanceSheet");
  });

  it("classifies 4xxx as ProfitLoss", () => {
    expect(sectionFor6111Line("4010")).toBe("ProfitLoss");
  });

  it("classifies 5xxx as ProfitLoss", () => {
    expect(sectionFor6111Line("5010")).toBe("ProfitLoss");
  });

  it("classifies 7xxx as ProfitLoss", () => {
    expect(sectionFor6111Line("7040")).toBe("ProfitLoss");
  });
});

describe("form6111 aggregateJournalLinesTo6111", () => {
  it("buckets income by 4xxx line", () => {
    const agg = aggregateJournalLinesTo6111([
      { accountCode: "4000", debitMinor: 0n, creditMinor: 1_000_00n },
      { accountCode: "4000", debitMinor: 0n, creditMinor: 500_00n },
    ]);
    const line = agg.byLine.get("4010");
    expect(line).toBeDefined();
    // Income: credit-debit = +1500 IS
    expect(line!.amountMinor).toBe(1_500_00n);
  });

  it("buckets expense by P&L line with debit-credit sign", () => {
    const agg = aggregateJournalLinesTo6111([
      { accountCode: "7000", debitMinor: 1_200_00n, creditMinor: 0n },
    ]);
    expect(agg.byLine.get("7010")!.amountMinor).toBe(1_200_00n);
  });

  it("buckets asset by BS line with debit-credit sign", () => {
    const agg = aggregateJournalLinesTo6111([
      { accountCode: "1010", debitMinor: 5_000_00n, creditMinor: 0n },
      { accountCode: "1010", debitMinor: 0n, creditMinor: 1_000_00n },
    ]);
    // Bank: debit-credit = +400000 minor
    expect(agg.byLine.get("1011")!.amountMinor).toBe(4_000_00n);
  });

  it("collapses multiple codes into the same 6111 line", () => {
    const agg = aggregateJournalLinesTo6111([
      { accountCode: "1010", debitMinor: 1_000_00n, creditMinor: 0n }, // -> 1011
      { accountCode: "1020", debitMinor: 500_00n, creditMinor: 0n },  // -> 1011
    ]);
    expect(agg.byLine.size).toBe(1);
    expect(agg.byLine.get("1011")!.amountMinor).toBe(1_500_00n);
  });

  it("returns unmapped codes when 6111 line is null", () => {
    const agg = aggregateJournalLinesTo6111([
      { accountCode: "1450", debitMinor: 100n, creditMinor: 0n }, // null mapping
      { accountCode: "9999", debitMinor: 100n, creditMinor: 0n }, // unknown code
    ]);
    expect(agg.byLine.size).toBe(0);
    expect(agg.unmappedCodes).toContain("1450");
    expect(agg.unmappedCodes).toContain("9999");
  });

  it("handles empty input", () => {
    const agg = aggregateJournalLinesTo6111([]);
    expect(agg.byLine.size).toBe(0);
    expect(agg.unmappedCodes).toEqual([]);
  });
});

describe("form6111 renderForm6111Xml", () => {
  it("produces a UTF-8 XML declaration", () => {
    const xml = renderForm6111Xml({
      businessVatId: "514321987",
      legalName: "Test Co",
      fiscalYear: 2025,
      generatedAt: new Date(Date.UTC(2026, 4, 16, 12, 0, 0)),
      aggregation: { byLine: new Map(), unmappedCodes: [] },
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it("uses the namespaced Form6111 root", () => {
    const xml = renderForm6111Xml({
      businessVatId: "514321987",
      legalName: "Test Co",
      fiscalYear: 2025,
      generatedAt: new Date(),
      aggregation: { byLine: new Map(), unmappedCodes: [] },
    });
    expect(xml).toContain('<Form6111 xmlns="urn:il:tax:form6111:v1">');
    expect(xml).toContain("</Form6111>");
  });

  it("emits BalanceSheet and ProfitLoss sections", () => {
    const xml = renderForm6111Xml({
      businessVatId: "514321987",
      legalName: "Test Co",
      fiscalYear: 2025,
      generatedAt: new Date(),
      aggregation: { byLine: new Map(), unmappedCodes: [] },
    });
    expect(xml).toContain("<BalanceSheet>");
    expect(xml).toContain("</BalanceSheet>");
    expect(xml).toContain("<ProfitLoss>");
    expect(xml).toContain("</ProfitLoss>");
  });

  it("emits one <Line> element per aggregated bucket, sorted by code", () => {
    const agg = aggregateJournalLinesTo6111([
      { accountCode: "7000", debitMinor: 100_00n, creditMinor: 0n }, // 7010
      { accountCode: "4000", debitMinor: 0n, creditMinor: 200_00n }, // 4010
      { accountCode: "1010", debitMinor: 50_00n, creditMinor: 0n },  // 1011 (BS)
    ]);
    const xml = renderForm6111Xml({
      businessVatId: "514321987",
      legalName: "Test Co",
      fiscalYear: 2025,
      generatedAt: new Date(Date.UTC(2026, 4, 16, 12, 0, 0)),
      aggregation: agg,
    });
    expect(xml).toContain('code="1011"');
    expect(xml).toContain('code="4010"');
    expect(xml).toContain('code="7010"');
    // 1011 must appear before 4010 within the document (1011 is BS, 4010 is PL).
    expect(xml.indexOf("1011")).toBeLessThan(xml.indexOf("4010"));
  });

  it("XML-escapes legal name with special chars", () => {
    const xml = renderForm6111Xml({
      businessVatId: "514321987",
      legalName: 'Smith & Co "Ltd"',
      fiscalYear: 2025,
      generatedAt: new Date(),
      aggregation: { byLine: new Map(), unmappedCodes: [] },
    });
    expect(xml).toContain("Smith &amp; Co &quot;Ltd&quot;");
    expect(xml).not.toContain('Smith & Co "Ltd"');
  });

  it("renders signed amountMinor in attribute (no decimal)", () => {
    const agg = aggregateJournalLinesTo6111([
      { accountCode: "4000", debitMinor: 0n, creditMinor: 1_234_56n },
    ]);
    const xml = renderForm6111Xml({
      businessVatId: "514321987",
      legalName: "Test Co",
      fiscalYear: 2025,
      generatedAt: new Date(),
      aggregation: agg,
    });
    expect(xml).toContain('amountMinor="123456"');
  });

  it("preserves negative amounts (e.g. net loss expense > income)", () => {
    const agg = aggregateJournalLinesTo6111([
      // Two postings to same income line, but a credit-note style debit > credit
      // would produce a negative income (which is unusual but valid).
      { accountCode: "4000", debitMinor: 200_00n, creditMinor: 100_00n },
    ]);
    const xml = renderForm6111Xml({
      businessVatId: "514321987",
      legalName: "Test Co",
      fiscalYear: 2025,
      generatedAt: new Date(),
      aggregation: agg,
    });
    expect(xml).toContain('amountMinor="-10000"');
  });
});

describe("form6111 generateForm6111 — spec gate", () => {
  it("throws Form6111SpecNotVerified without ack flag", async () => {
    await expect(
      generateForm6111({
        userId: "00000000-0000-0000-0000-000000000000",
        businessId: "00000000-0000-0000-0000-000000000000",
        fiscalYear: 2025,
      }),
    ).rejects.toBeInstanceOf(Form6111SpecNotVerified);
  });

  it("throws on implausible fiscalYear even with ack", async () => {
    await expect(
      generateForm6111({
        userId: "00000000-0000-0000-0000-000000000000",
        businessId: "00000000-0000-0000-0000-000000000000",
        fiscalYear: 1900,
        acknowledgeSpecUnverified: true,
      }),
    ).rejects.toThrow(/implausible/);
  });
});
