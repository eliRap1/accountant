import { describe, it, expect } from "vitest";
import {
  buildHeader,
  buildDetail,
  buildTrailer,
  assemblePcn874,
  findSequenceGap,
  generatePcn874,
  Pcn874SpecNotVerified,
  PCN874_HEADER_WIDTH,
  PCN874_DETAIL_WIDTH,
  PCN874_TRAILER_WIDTH,
  PCN874_LINE_TERMINATOR,
  type Pcn874DetailRow,
} from "@/lib/filings/pcn874";
import { decodeWindows1255 } from "@/lib/filings/windows1255";

const VAT_ID = "514321987";
const REPORT_DATE = new Date(Date.UTC(2026, 4, 16));

describe("pcn874 buildHeader", () => {
  it("produces a 50-char header line", () => {
    const line = buildHeader({
      businessVatId: VAT_ID,
      periodYear: 2026,
      periodMonth: 4,
      reportDate: REPORT_DATE,
    });
    expect(line.length).toBe(PCN874_HEADER_WIDTH);
  });

  it("starts with 'A' record type", () => {
    const line = buildHeader({
      businessVatId: VAT_ID,
      periodYear: 2026,
      periodMonth: 4,
      reportDate: REPORT_DATE,
    });
    expect(line[0]).toBe("A");
  });

  it("encodes period as YYYYMM at offset 10", () => {
    const line = buildHeader({
      businessVatId: VAT_ID,
      periodYear: 2026,
      periodMonth: 4,
      reportDate: REPORT_DATE,
    });
    expect(line.slice(10, 16)).toBe("202604");
  });

  it("encodes report date YYYYMMDD at offset 16", () => {
    const line = buildHeader({
      businessVatId: VAT_ID,
      periodYear: 2026,
      periodMonth: 4,
      reportDate: REPORT_DATE,
    });
    expect(line.slice(16, 24)).toBe("20260516");
  });

  it("zero-pads vat_id with leading zeros at offset 1", () => {
    const line = buildHeader({
      businessVatId: "123",
      periodYear: 2026,
      periodMonth: 1,
      reportDate: REPORT_DATE,
    });
    expect(line.slice(1, 10)).toBe("000000123");
  });

  it("strips non-digit chars from vat_id", () => {
    const line = buildHeader({
      businessVatId: "ע.מ. 514321987",
      periodYear: 2026,
      periodMonth: 1,
      reportDate: REPORT_DATE,
    });
    expect(line.slice(1, 10)).toBe("514321987");
  });

  it("throws on month outside 1-12", () => {
    expect(() =>
      buildHeader({
        businessVatId: VAT_ID,
        periodYear: 2026,
        periodMonth: 13,
        reportDate: REPORT_DATE,
      }),
    ).toThrow(/1-12/);
  });
});

describe("pcn874 buildDetail", () => {
  const row: Pcn874DetailRow = {
    invoiceNumber: 42,
    invoiceDate: new Date(Date.UTC(2026, 3, 15)),
    clientVatId: "510987654",
    indicator: "I",
    preVatAmountMinor: 100_000n, // ₪1,000.00
    vatAmountMinor: 18_000n,    // ₪180.00
  };

  it("produces an 80-char detail line", () => {
    const line = buildDetail(VAT_ID, row);
    expect(line.length).toBe(PCN874_DETAIL_WIDTH);
  });

  it("starts with 'B' record type", () => {
    expect(buildDetail(VAT_ID, row)[0]).toBe("B");
  });

  it("encodes invoice number zero-padded at fixed offset", () => {
    const line = buildDetail(VAT_ID, row);
    // offset 10 (after 'B' + 9-char businessVatId), 15 chars wide
    expect(line.slice(10, 25)).toBe("000000000000042");
  });

  it("encodes invoice date YYYYMMDD at offset 25", () => {
    const line = buildDetail(VAT_ID, row);
    expect(line.slice(25, 33)).toBe("20260415");
  });

  it("encodes client vat_id zero-padded at offset 33", () => {
    const line = buildDetail(VAT_ID, row);
    expect(line.slice(33, 42)).toBe("510987654");
  });

  it("fills client vat_id with zeros when null (B2C)", () => {
    const line = buildDetail(VAT_ID, { ...row, clientVatId: null });
    expect(line.slice(33, 42)).toBe("000000000");
  });

  it("encodes indicator at offset 42", () => {
    const line = buildDetail(VAT_ID, { ...row, indicator: "Z" });
    expect(line.slice(42, 43)).toBe("Z");
  });

  it("encodes signed pre-VAT amount with '+' for positive", () => {
    const line = buildDetail(VAT_ID, row);
    // pos 43-54 = 12 chars: sign + 11-char magnitude
    expect(line.slice(43, 44)).toBe("+");
    expect(line.slice(44, 55)).toBe("00000100000");
  });

  it("encodes signed pre-VAT amount with '-' for credit notes", () => {
    const line = buildDetail(VAT_ID, {
      ...row,
      preVatAmountMinor: -100_000n,
      indicator: "C",
    });
    expect(line.slice(43, 44)).toBe("-");
    expect(line.slice(44, 55)).toBe("00000100000");
  });

  it("encodes unsigned VAT amount at offset 55", () => {
    const line = buildDetail(VAT_ID, row);
    // 11 chars wide
    expect(line.slice(55, 66)).toBe("00000018000");
  });

  it("throws on negative VAT amount", () => {
    expect(() =>
      buildDetail(VAT_ID, { ...row, vatAmountMinor: -1n }),
    ).toThrow(/non-negative/);
  });
});

describe("pcn874 buildTrailer", () => {
  it("produces a 50-char trailer line", () => {
    const line = buildTrailer({
      businessVatId: VAT_ID,
      detailCount: 5,
      sumPreVatMinor: 500_000n,
      sumVatMinor: 90_000n,
    });
    expect(line.length).toBe(PCN874_TRAILER_WIDTH);
  });

  it("starts with 'C' record type", () => {
    const line = buildTrailer({
      businessVatId: VAT_ID,
      detailCount: 0,
      sumPreVatMinor: 0n,
      sumVatMinor: 0n,
    });
    expect(line[0]).toBe("C");
  });

  it("encodes detail count zero-padded at offset 10", () => {
    const line = buildTrailer({
      businessVatId: VAT_ID,
      detailCount: 5,
      sumPreVatMinor: 0n,
      sumVatMinor: 0n,
    });
    expect(line.slice(10, 18)).toBe("00000005");
  });

  it("encodes signed total sumPreVat with leading sign", () => {
    const line = buildTrailer({
      businessVatId: VAT_ID,
      detailCount: 1,
      sumPreVatMinor: 250_000n,
      sumVatMinor: 0n,
    });
    expect(line.slice(18, 19)).toBe("+");
    expect(line.slice(19, 32)).toBe("0000000250000");
  });

  it("supports negative sumPreVat (net refund period)", () => {
    const line = buildTrailer({
      businessVatId: VAT_ID,
      detailCount: 1,
      sumPreVatMinor: -250_000n,
      sumVatMinor: 0n,
    });
    expect(line.slice(18, 19)).toBe("-");
  });

  it("throws on negative sumVat", () => {
    expect(() =>
      buildTrailer({
        businessVatId: VAT_ID,
        detailCount: 1,
        sumPreVatMinor: 0n,
        sumVatMinor: -1n,
      }),
    ).toThrow(/non-negative/);
  });
});

describe("pcn874 assemblePcn874 — happy path golden", () => {
  const detail1: Pcn874DetailRow = {
    invoiceNumber: 1,
    invoiceDate: new Date(Date.UTC(2026, 3, 5)),
    clientVatId: "510987654",
    indicator: "I",
    preVatAmountMinor: 1_000_00n,
    vatAmountMinor: 180_00n,
  };
  const detail2: Pcn874DetailRow = {
    invoiceNumber: 2,
    invoiceDate: new Date(Date.UTC(2026, 3, 10)),
    clientVatId: null,
    indicator: "I",
    preVatAmountMinor: 500_00n,
    vatAmountMinor: 90_00n,
  };

  it("produces 3 CRLF-terminated lines (header + 2 details + trailer)", () => {
    const buf = assemblePcn874(VAT_ID, {
      businessVatId: VAT_ID,
      periodYear: 2026,
      periodMonth: 4,
      reportDate: REPORT_DATE,
    }, [detail1, detail2]);
    const decoded = decodeWindows1255(buf);
    const lines = decoded.split(PCN874_LINE_TERMINATOR);
    // 3 logical lines + a trailing empty from the terminator after the
    // final line.
    expect(lines.length).toBe(5);
    expect(lines[0]!.startsWith("A")).toBe(true);
    expect(lines[1]!.startsWith("B")).toBe(true);
    expect(lines[2]!.startsWith("B")).toBe(true);
    expect(lines[3]!.startsWith("C")).toBe(true);
    expect(lines[4]).toBe("");
  });

  it("trailer count matches detail row count", () => {
    const buf = assemblePcn874(VAT_ID, {
      businessVatId: VAT_ID,
      periodYear: 2026,
      periodMonth: 4,
      reportDate: REPORT_DATE,
    }, [detail1, detail2]);
    const decoded = decodeWindows1255(buf);
    const lines = decoded.split(PCN874_LINE_TERMINATOR);
    const trailer = lines[3]!;
    expect(trailer.slice(10, 18)).toBe("00000002");
  });

  it("trailer sums match line totals exactly", () => {
    const buf = assemblePcn874(VAT_ID, {
      businessVatId: VAT_ID,
      periodYear: 2026,
      periodMonth: 4,
      reportDate: REPORT_DATE,
    }, [detail1, detail2]);
    const decoded = decodeWindows1255(buf);
    const lines = decoded.split(PCN874_LINE_TERMINATOR);
    const trailer = lines[3]!;
    // sumPreVat = 100000 + 50000 = 150000, signed positive
    expect(trailer.slice(18, 19)).toBe("+");
    expect(trailer.slice(19, 32)).toBe("0000000150000");
    // sumVat = 18000 + 9000 = 27000
    expect(trailer.slice(32, 45)).toBe("0000000027000");
  });

  it("renders to windows-1255 bytes (no UTF-8 BOM)", () => {
    const buf = assemblePcn874(VAT_ID, {
      businessVatId: VAT_ID,
      periodYear: 2026,
      periodMonth: 4,
      reportDate: REPORT_DATE,
    }, [detail1]);
    // First byte must be 'A' (0x41) — no BOM, no leading control char.
    expect(buf[0]).toBe(0x41);
  });
});

describe("pcn874 findSequenceGap", () => {
  it("returns null on empty input", () => {
    expect(findSequenceGap([])).toBeNull();
  });

  it("returns null on single number", () => {
    expect(findSequenceGap([5])).toBeNull();
  });

  it("returns null on contiguous sequence", () => {
    expect(findSequenceGap([1, 2, 3, 4, 5])).toBeNull();
  });

  it("detects a single-row gap", () => {
    // 3 missing in the middle
    expect(findSequenceGap([1, 2, 4, 5])).toBe(3);
  });

  it("detects a multi-row gap (returns first missing)", () => {
    // 3 + 4 + 5 missing; first gap is 3.
    expect(findSequenceGap([1, 2, 6, 7])).toBe(3);
  });

  it("returns null when cancelled invoices are included in an otherwise contiguous sequence", () => {
    // Simulates generatePcn874 passing ALL sequence numbers (including
    // cancelled ones) rather than filtering them out. Invoices 1,2,4 active;
    // invoice 3 cancelled — but still holds its sequence slot. The full
    // series [1,2,3,4] is contiguous; no gap should be reported.
    expect(findSequenceGap([1, 2, 3, 4])).toBeNull();
  });

  it("still detects a real gap even when cancelled rows are present", () => {
    // Invoice 3 cancelled, invoice 4 is missing entirely (never issued).
    // Series [1,2,3,5] has a gap at 4.
    expect(findSequenceGap([1, 2, 3, 5])).toBe(4);
  });
});

describe("pcn874 generatePcn874 — spec gate", () => {
  it("throws Pcn874SpecNotVerified without acknowledgement flag", async () => {
    await expect(
      generatePcn874({
        userId: "00000000-0000-0000-0000-000000000000",
        businessId: "00000000-0000-0000-0000-000000000000",
        periodStart: new Date(Date.UTC(2026, 3, 1)),
        periodEnd: new Date(Date.UTC(2026, 3, 30)),
      }),
    ).rejects.toBeInstanceOf(Pcn874SpecNotVerified);
  });

  it("throws on inverted period bounds even with ack", async () => {
    await expect(
      generatePcn874({
        userId: "00000000-0000-0000-0000-000000000000",
        businessId: "00000000-0000-0000-0000-000000000000",
        periodStart: new Date(Date.UTC(2026, 5, 1)),
        periodEnd: new Date(Date.UTC(2026, 3, 1)),
        acknowledgeSpecUnverified: true,
      }),
    ).rejects.toThrow(/before periodStart/);
  });
});
