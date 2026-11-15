import { describe, it, expect, beforeEach, vi } from "vitest";

// Drive the SDK boundary at the seam — `generateObject` from "ai" is the
// only externalised call inside extractReceipt(). We mock it with a
// queue of canned responses keyed by the order of calls.

type CannedResponse = {
  object?: unknown;
  shouldThrow?: Error;
};

let queue: CannedResponse[];
let lastCallArgs: Record<string, unknown> | null;

vi.mock("ai", () => ({
  generateObject: vi.fn(async (args: Record<string, unknown>) => {
    lastCallArgs = args;
    const next = queue.shift();
    if (!next) {
      throw new Error("test queue exhausted — add a canned response");
    }
    if (next.shouldThrow) throw next.shouldThrow;
    return { object: next.object };
  }),
}));

// Force the gateway helper to report enabled + return a fake model.
vi.mock("@/lib/ai/gateway", () => ({
  isAiGatewayEnabled: () => true,
  getDefaultModel: () => ({ provider: "mock", modelId: "mock-vision" }),
  requireDefaultModel: () => ({ provider: "mock", modelId: "mock-vision" }),
}));

const {
  extractReceipt,
  ocrResultSchema,
  coerceOcrForTests,
} = await import("@/lib/receipts/ocr");

beforeEach(() => {
  queue = [];
  lastCallArgs = null;
});

describe("ocrResultSchema (zod shape)", () => {
  it("accepts a well-formed extraction", () => {
    const parsed = ocrResultSchema.safeParse({
      vendor: "ארומה",
      amount_major: 12.5,
      currency: "ILS",
      vat_major: 1.91,
      vat_rate: 18,
      date: "2026-05-12",
      items: [{ description: "קפה הפוך", amount_major: 12.5 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects amounts that are not numbers", () => {
    const parsed = ocrResultSchema.safeParse({
      vendor: "X",
      amount_major: "12.50",
      currency: "ILS",
      vat_major: null,
      vat_rate: null,
      date: "2026-05-12",
      items: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects malformed dates (must be ISO YYYY-MM-DD)", () => {
    const parsed = ocrResultSchema.safeParse({
      vendor: "X",
      amount_major: 1,
      currency: "ILS",
      vat_major: null,
      vat_rate: null,
      date: "12/05/2026",
      items: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects currencies outside the supported set", () => {
    const parsed = ocrResultSchema.safeParse({
      vendor: "X",
      amount_major: 1,
      currency: "JPY",
      vat_major: null,
      vat_rate: null,
      date: "2026-05-12",
      items: [],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("coerceOcrForTests — major → minor conversion", () => {
  it("rounds major-unit floats to bigint minor units", () => {
    const out = coerceOcrForTests({
      vendor: "X",
      amount_major: 12.5,
      currency: "ILS",
      vat_major: 1.91,
      vat_rate: 18,
      date: "2026-05-12",
      items: [{ description: "line", amount_major: 12.5 }],
    });
    expect(out.amount_minor).toBe(1250n);
    expect(out.vat_minor).toBe(191n);
    expect(out.items[0]?.amount_minor).toBe(1250n);
  });

  it("preserves null vat fields", () => {
    const out = coerceOcrForTests({
      vendor: "X",
      amount_major: 5,
      currency: "USD",
      vat_major: null,
      vat_rate: null,
      date: "2026-05-12",
      items: [],
    });
    expect(out.vat_minor).toBeNull();
    expect(out.vat_rate).toBeNull();
  });
});

describe("extractReceipt", () => {
  it("returns a coerced OcrResult on a well-formed model response", async () => {
    queue = [
      {
        object: {
          vendor: "ארומה",
          amount_major: 25.5,
          currency: "ILS",
          vat_major: 3.89,
          vat_rate: 18,
          date: "2026-05-12",
          items: [{ description: "קפה", amount_major: 25.5 }],
        },
      },
    ];
    const result = await extractReceipt(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg");
    expect(result).not.toBeNull();
    expect(result?.vendor).toBe("ארומה");
    expect(result?.amount_minor).toBe(2550n);
    expect(result?.vat_minor).toBe(389n);
    expect(result?.currency).toBe("ILS");
    expect(result?.date).toBe("2026-05-12");
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.amount_minor).toBe(2550n);
  });

  it("forwards image bytes as a multimodal image part", async () => {
    queue = [
      {
        object: {
          vendor: "X",
          amount_major: 1,
          currency: "ILS",
          vat_major: null,
          vat_rate: null,
          date: "2026-05-12",
          items: [],
        },
      },
    ];
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await extractReceipt(buf, "image/png");
    expect(lastCallArgs).not.toBeNull();
    const messages = lastCallArgs?.["messages"] as Array<{
      role: string;
      content: Array<{ type: string; image?: Buffer }>;
    }>;
    expect(messages[0]?.role).toBe("user");
    const imagePart = messages[0]?.content.find((p) => p.type === "image");
    expect(imagePart).toBeDefined();
    expect(imagePart?.image).toBe(buf);
  });

  it("forwards PDF bytes as a file part with mediaType", async () => {
    queue = [
      {
        object: {
          vendor: "X",
          amount_major: 1,
          currency: "ILS",
          vat_major: null,
          vat_rate: null,
          date: "2026-05-12",
          items: [],
        },
      },
    ];
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    await extractReceipt(buf, "application/pdf");
    const messages = lastCallArgs?.["messages"] as Array<{
      role: string;
      content: Array<{ type: string; mediaType?: string; data?: Buffer }>;
    }>;
    const filePart = messages[0]?.content.find((p) => p.type === "file");
    expect(filePart).toBeDefined();
    expect(filePart?.mediaType).toBe("application/pdf");
    expect(filePart?.data).toBe(buf);
  });

  it("returns null when the model throws", async () => {
    queue = [{ shouldThrow: new Error("model timeout") }];
    const result = await extractReceipt(
      Buffer.from([0xff, 0xd8, 0xff]),
      "image/jpeg",
    );
    expect(result).toBeNull();
  });

  it("returns null for unsupported MIME types", async () => {
    const result = await extractReceipt(
      Buffer.from([0x00, 0x01]),
      "application/octet-stream",
    );
    expect(result).toBeNull();
  });
});
