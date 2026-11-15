import { describe, it, expect } from "vitest";
import {
  renderMorningBriefSentence,
  renderMorningBriefSubject,
  MORNING_BRIEF_DISCLAIMER,
  type MorningBriefSentenceInput,
} from "@/lib/ai/morningBriefSentence";

// All five action-next branches × HE + EN. Plus disclaimer + subject
// rendering checks. Pure function — no DB, no IO — so these run flat.

function input(
  overrides: Partial<MorningBriefSentenceInput>,
): MorningBriefSentenceInput {
  return {
    locale: "he-IL",
    action: "nothing_urgent",
    userName: "יוסי",
    vatDueMinor: 0n,
    vatDueDate: new Date(Date.UTC(2026, 6, 15)), // 2026-07-15
    cashOnHandMinor: 0n,
    cashGapMinor: 0n,
    pendingReceiptCount: 0,
    oldestPendingReceipt: null,
    overdueInvoiceCount: 0,
    overdueInvoiceTotalMinor: 0n,
    ...overrides,
  };
}

describe("renderMorningBriefSentence — action: pay_vat (cash short)", () => {
  it("HE: surfaces the gap explicitly with a chase-clients nudge", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "he-IL",
        action: "pay_vat",
        vatDueMinor: 342_000n, // ₪3,420
        cashOnHandMinor: 218_000n, // ₪2,180
        cashGapMinor: 124_000n, // ₪1,240
      }),
    );
    expect(out).toContain("בוקר טוב יוסי");
    expect(out).toContain("₪3,420");
    expect(out).toContain("₪2,180");
    expect(out).toContain("חסר ₪1,240");
    expect(out).toContain("15.7");
    // Disclaimer suffix is always present.
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.he);
  });

  it("EN: surfaces the gap explicitly with a chase-clients nudge", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "en-US",
        action: "pay_vat",
        userName: "Yossi",
        vatDueMinor: 342_000n,
        cashOnHandMinor: 218_000n,
        cashGapMinor: 124_000n,
      }),
    );
    expect(out).toContain("Good morning Yossi");
    expect(out).toContain("₪3,420");
    expect(out).toContain("₪2,180");
    expect(out).toContain("short ₪1,240");
    expect(out).toContain("Jul 15");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.en);
  });
});

describe("renderMorningBriefSentence — action: pay_vat (covered)", () => {
  it("HE: reassures when cash covers VAT", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "he-IL",
        action: "pay_vat",
        vatDueMinor: 342_000n,
        cashOnHandMinor: 500_000n,
        cashGapMinor: 0n,
      }),
    );
    expect(out).toContain("מכוסה");
    expect(out).toContain("₪3,420");
    expect(out).toContain("₪5,000");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.he);
  });

  it("EN: reassures when cash covers VAT", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "en-US",
        action: "pay_vat",
        userName: null,
        vatDueMinor: 342_000n,
        cashOnHandMinor: 500_000n,
        cashGapMinor: 0n,
      }),
    );
    expect(out).toContain("Good morning.");
    expect(out).toContain("covered");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.en);
  });
});

describe("renderMorningBriefSentence — action: follow_up_overdue", () => {
  it("HE: surfaces count + sum + how it helps VAT", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "he-IL",
        action: "follow_up_overdue",
        overdueInvoiceCount: 3,
        overdueInvoiceTotalMinor: 1_500_000n, // ₪15,000
        vatDueMinor: 342_000n,
      }),
    );
    expect(out).toContain("3 חשבוניות פתוחות");
    expect(out).toContain("₪15,000");
    expect(out).toContain("₪3,420");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.he);
  });

  it("HE: singular form for a single overdue invoice", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "he-IL",
        action: "follow_up_overdue",
        overdueInvoiceCount: 1,
        overdueInvoiceTotalMinor: 500_000n,
      }),
    );
    expect(out).toContain("1 חשבונית פתוחה");
    expect(out).toContain("₪5,000");
  });

  it("EN: surfaces count + sum + how it helps VAT", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "en-US",
        action: "follow_up_overdue",
        userName: "Yossi",
        overdueInvoiceCount: 3,
        overdueInvoiceTotalMinor: 1_500_000n,
        vatDueMinor: 342_000n,
      }),
    );
    expect(out).toContain("3 invoices are");
    expect(out).toContain("₪15,000");
    expect(out).toContain("₪3,420");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.en);
  });
});

describe("renderMorningBriefSentence — action: categorise_receipts", () => {
  it("HE: surfaces the oldest receipt vendor + amount", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "he-IL",
        action: "categorise_receipts",
        pendingReceiptCount: 1,
        oldestPendingReceipt: {
          vendor: "Ofer Yogev",
          amountMinor: 38_000n, // ₪380
        },
        vatDueMinor: 342_000n,
      }),
    );
    expect(out).toContain("1 קבלה לא מסווגת");
    expect(out).toContain("Ofer Yogev");
    expect(out).toContain("₪380");
    expect(out).toContain("₪3,420");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.he);
  });

  it("HE: falls back gracefully when vendor is encrypted (null)", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "he-IL",
        action: "categorise_receipts",
        pendingReceiptCount: 4,
        oldestPendingReceipt: { vendor: null, amountMinor: 50_000n },
        vatDueMinor: 342_000n,
      }),
    );
    expect(out).toContain("4 קבלות לא מסווגות");
    expect(out).toContain("ספק לא ידוע");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.he);
  });

  it("EN: surfaces vendor + amount + VAT what-if when provided", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "en-US",
        action: "categorise_receipts",
        userName: "Yossi",
        pendingReceiptCount: 1,
        oldestPendingReceipt: {
          vendor: "Ofer Yogev",
          amountMinor: 38_000n,
        },
        vatDueMinor: 342_000n,
        vatIfCategorisedMinor: 335_500n,
      }),
    );
    expect(out).toContain("1 uncategorised receipt");
    expect(out).toContain("Ofer Yogev");
    expect(out).toContain("₪380");
    expect(out).toContain("drops the");
    expect(out).toContain("₪3,420");
    expect(out).toContain("₪3,355");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.en);
  });
});

describe("renderMorningBriefSentence — action: nothing_urgent", () => {
  it("HE: friendly quiet morning with next VAT anchor", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "he-IL",
        action: "nothing_urgent",
        vatDueMinor: 200_000n, // ₪2,000
      }),
    );
    expect(out).toContain("בוקר טוב יוסי");
    expect(out).toContain("אין משימה דחופה");
    expect(out).toContain("₪2,000");
    expect(out).toContain("15.7");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.he);
  });

  it("HE: omits VAT mention when no VAT due", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "he-IL",
        action: "nothing_urgent",
        vatDueMinor: 0n,
      }),
    );
    expect(out).not.toContain("מע״מ");
    expect(out).toContain("אין משימה דחופה");
  });

  it("EN: friendly quiet morning with next VAT anchor", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "en-US",
        action: "nothing_urgent",
        userName: "Yossi",
        vatDueMinor: 200_000n,
      }),
    );
    expect(out).toContain("Good morning Yossi");
    expect(out).toContain("Nothing urgent");
    expect(out).toContain("₪2,000");
    expect(out).toContain("Jul 15");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.en);
  });
});

describe("renderMorningBriefSentence — disclaimer behaviour", () => {
  it("idempotent: a second render keeps a single disclaimer suffix", () => {
    const i = input({
      locale: "he-IL",
      action: "pay_vat",
      vatDueMinor: 342_000n,
      cashOnHandMinor: 500_000n,
    });
    const out = renderMorningBriefSentence(i);
    // The disclaimer text appears once.
    const matches = out.match(/אומדנים בלבד/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("ru-RU falls through to English copy (Plan v4 Risk #24)", () => {
    const out = renderMorningBriefSentence(
      input({
        locale: "ru-RU",
        action: "nothing_urgent",
        userName: "Igor",
        vatDueMinor: 200_000n,
      }),
    );
    expect(out).toContain("Good morning Igor");
    expect(out).toContain(MORNING_BRIEF_DISCLAIMER.en);
    expect(out).not.toContain(MORNING_BRIEF_DISCLAIMER.he);
  });
});

describe("renderMorningBriefSubject", () => {
  it("HE: pay_vat subject contains amount + date", () => {
    const s = renderMorningBriefSubject(
      input({
        locale: "he-IL",
        action: "pay_vat",
        vatDueMinor: 342_000n,
      }),
    );
    expect(s).toContain("₪3,420");
    expect(s).toContain("15.7");
    expect(s).toContain("מע״מ");
  });

  it("EN: nothing_urgent subject reads 'all clear'", () => {
    const s = renderMorningBriefSubject(
      input({ locale: "en-US", action: "nothing_urgent" }),
    );
    expect(s).toContain("all clear");
  });

  it("HE: receipts subject contains the count", () => {
    const s = renderMorningBriefSubject(
      input({
        locale: "he-IL",
        action: "categorise_receipts",
        pendingReceiptCount: 5,
      }),
    );
    expect(s).toContain("5 קבלות");
  });
});
