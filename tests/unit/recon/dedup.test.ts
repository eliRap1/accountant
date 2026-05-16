import { describe, it, expect } from "vitest";
import {
  fingerprintTransaction,
  normalizeCounterparty,
} from "@/lib/recon/dedup";

describe("normalizeCounterparty", () => {
  it("lowercases + trims", () => {
    expect(normalizeCounterparty("  Acme Corp  ")).toBe("acme corp");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeCounterparty("Acme    Corp")).toBe("acme corp");
  });

  it("strips trailing 'Ltd' suffix", () => {
    expect(normalizeCounterparty("Acme Ltd")).toBe("acme");
  });

  it("strips trailing 'Inc' suffix", () => {
    expect(normalizeCounterparty("WidgetCo Inc.")).toBe("widgetco");
  });

  it("strips trailing 'בע\"מ' suffix (Hebrew Ltd marker)", () => {
    expect(normalizeCounterparty("חברת אקמה בע\"מ")).toBe("חברת אקמה");
  });

  it("handles empty input", () => {
    expect(normalizeCounterparty("")).toBe("");
  });

  it("non-string input returns empty", () => {
    // @ts-expect-error — defensive guard.
    expect(normalizeCounterparty(undefined)).toBe("");
  });
});

describe("fingerprintTransaction", () => {
  const base = {
    amountMinor: 12_345n,
    txnDate: new Date(Date.UTC(2026, 4, 16, 14, 22, 0)),
    counterparty: "Acme Ltd",
  };

  it("is deterministic — same input -> same hash", () => {
    const a = fingerprintTransaction(base);
    const b = fingerprintTransaction(base);
    expect(a).toBe(b);
  });

  it("is case-insensitive on counterparty", () => {
    const a = fingerprintTransaction(base);
    const b = fingerprintTransaction({ ...base, counterparty: "ACME LTD" });
    expect(a).toBe(b);
  });

  it("trims and collapses whitespace on counterparty", () => {
    const a = fingerprintTransaction(base);
    const b = fingerprintTransaction({
      ...base,
      counterparty: "  acme    ltd  ",
    });
    expect(a).toBe(b);
  });

  it("differs when amount changes", () => {
    const a = fingerprintTransaction(base);
    const b = fingerprintTransaction({ ...base, amountMinor: 12_346n });
    expect(a).not.toBe(b);
  });

  it("differs when date differs by a day", () => {
    const a = fingerprintTransaction(base);
    const b = fingerprintTransaction({
      ...base,
      txnDate: new Date(Date.UTC(2026, 4, 17, 14, 22, 0)),
    });
    expect(a).not.toBe(b);
  });

  it("is invariant within the same UTC day even at different hours", () => {
    const morning = fingerprintTransaction({
      ...base,
      txnDate: new Date(Date.UTC(2026, 4, 16, 0, 5, 0)),
    });
    const evening = fingerprintTransaction({
      ...base,
      txnDate: new Date(Date.UTC(2026, 4, 16, 23, 55, 0)),
    });
    expect(morning).toBe(evening);
  });

  it("differs when counterparty differs after normalisation", () => {
    const a = fingerprintTransaction({
      ...base,
      counterparty: "Acme Ltd",
    });
    const b = fingerprintTransaction({
      ...base,
      counterparty: "WidgetCo Inc.",
    });
    expect(a).not.toBe(b);
  });

  it("produces a 64-character hex digest (SHA-256)", () => {
    const fp = fingerprintTransaction(base);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
