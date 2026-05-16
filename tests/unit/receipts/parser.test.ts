import { describe, it, expect } from "vitest";
import {
  categoriseByVendor,
  categoriseByAmount,
  parseReceiptToTransaction,
  type Business,
} from "@/lib/receipts/parser";
import type { OcrResult } from "@/lib/receipts/ocr";

// Minimal Business stub — only id is consulted by the parser.
function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    ownerUserId: "00000000-0000-0000-0000-000000000002",
    legalName: "Test Biz",
    vatId: "514321987",
    entityType: "morshe",
    vatStatus: "osek_morshe",
    bookkeepingMethod: "single_entry",
    taxYearEndMonth: 12,
    advanceTaxRatePct: null,
    tikNikuyim: null,
    defaultCurrency: "ILS",
    nextInvoiceSequenceJsonb: {},
    addressStreet: null,
    addressCity: null,
    addressPostalCode: null,
    addressCountry: "IL",
    logoBlobUrl: null,
    signatureBlobUrl: null,
    ilMunicipalAuthority: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as Business;
}

function makeOcr(overrides: Partial<OcrResult> = {}): OcrResult {
  return {
    vendor: "Some Vendor",
    amount_minor: 5000n,
    currency: "ILS",
    vat_minor: 760n,
    vat_rate: 18,
    date: "2026-05-10",
    items: [],
    ...overrides,
  };
}

describe("categoriseByVendor", () => {
  it("matches English SaaS vendors to 8300", () => {
    expect(categoriseByVendor("OpenAI")).toEqual({
      code: "8300",
      label: "software_saas",
    });
    expect(categoriseByVendor("github inc")).toEqual({
      code: "8300",
      label: "software_saas",
    });
    expect(categoriseByVendor("Vercel Inc.")).toEqual({
      code: "8300",
      label: "software_saas",
    });
  });

  it("matches Hebrew telecom vendors to 8200", () => {
    expect(categoriseByVendor("בזק")).toEqual({
      code: "8200",
      label: "telecom",
    });
    expect(categoriseByVendor("חברת סלקום")).toEqual({
      code: "8200",
      label: "telecom",
    });
  });

  it("matches Hebrew fuel stations to 8500", () => {
    expect(categoriseByVendor("דלק תל-אביב")).toEqual({
      code: "8500",
      label: "fuel",
    });
    expect(categoriseByVendor("Paz Gas")).toEqual({
      code: "8500",
      label: "fuel",
    });
  });

  it("matches food chains to 8600", () => {
    expect(categoriseByVendor("ארומה תל אביב")).toEqual({
      code: "8600",
      label: "meals",
    });
    expect(categoriseByVendor("Cofix Branch 12")).toEqual({
      code: "8600",
      label: "meals",
    });
  });

  it("returns null for unrecognised vendors", () => {
    expect(categoriseByVendor("Ploni's Mystery Shop")).toBeNull();
    expect(categoriseByVendor("חנות בלתי מזוהה")).toBeNull();
  });

  it("is case-insensitive for ASCII vendor names", () => {
    expect(categoriseByVendor("GOOGLE LLC")).toEqual({
      code: "8300",
      label: "software_saas",
    });
    expect(categoriseByVendor("google llc")).toEqual({
      code: "8300",
      label: "software_saas",
    });
  });
});

describe("categoriseByAmount", () => {
  it("buckets small amounts as misc expense (8000)", () => {
    expect(categoriseByAmount(0n)).toEqual({ code: "8000", label: "misc_expense" });
    expect(categoriseByAmount(99_999n)).toEqual({
      code: "8000",
      label: "misc_expense",
    });
  });

  it("buckets amounts >= ₪1,000 as office equipment (8400)", () => {
    expect(categoriseByAmount(100_000n)).toEqual({
      code: "8400",
      label: "office_supplies",
    });
    expect(categoriseByAmount(5_000_000n)).toEqual({
      code: "8400",
      label: "office_supplies",
    });
  });
});

describe("parseReceiptToTransaction", () => {
  const biz = makeBusiness();

  it("uses vendor rule when one matches", () => {
    const draft = parseReceiptToTransaction(
      makeOcr({ vendor: "Google Cloud", amount_minor: 99n }),
      biz,
    );
    expect(draft.categoryCode).toBe("8300");
    expect(draft.businessId).toBe(biz.id);
    expect(draft.direction).toBe("expense");
    expect(draft.source).toBe("ocr");
    expect(draft.amountMinor).toBe(99n);
    expect(draft.currency).toBe("ILS");
    expect(draft.txnDate).toBe("2026-05-10");
  });

  it("falls back to amount band when vendor rule misses", () => {
    const small = parseReceiptToTransaction(
      makeOcr({ vendor: "ploni shop", amount_minor: 1_234n }),
      biz,
    );
    expect(small.categoryCode).toBe("8000");

    const big = parseReceiptToTransaction(
      makeOcr({ vendor: "ploni shop", amount_minor: 500_000n }),
      biz,
    );
    expect(big.categoryCode).toBe("8400");
  });

  it("includes the first OCR line description in the description", () => {
    const draft = parseReceiptToTransaction(
      makeOcr({
        vendor: "ארומה",
        items: [{ description: "קפה הפוך", amount_minor: 1_400n }],
      }),
      biz,
    );
    expect(draft.description).toContain("ארומה");
    expect(draft.description).toContain("קפה הפוך");
  });

  it("uses vendor only when items array is empty", () => {
    const draft = parseReceiptToTransaction(
      makeOcr({ vendor: "אייס", items: [] }),
      biz,
    );
    expect(draft.description).toBe("אייס");
  });

  it("preserves the receipt date in ISO format", () => {
    const draft = parseReceiptToTransaction(
      makeOcr({ date: "2026-01-15" }),
      biz,
    );
    expect(draft.txnDate).toBe("2026-01-15");
  });

  it("preserves the currency code from OCR", () => {
    const usd = parseReceiptToTransaction(
      makeOcr({ currency: "USD" }),
      biz,
    );
    expect(usd.currency).toBe("USD");
  });
});
