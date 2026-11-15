// Form 1214 — Annual corporate tax return prep-pack (ח.פ. / חברה בע"מ).
//
// Same shape as Form 1301 but corporate. The user prints + submits via
// the ITA business portal; we produce the SUMMARY + PDF PREP PACK only.
//
// === SPEC SOURCE STATUS ===
//
// Sandbox WebFetch on 2026-05-16 for the canonical Form 1214 PDF template
// was CF-blocked at gov.il. Structure below mirrors the public form:
// company-rate (currently 23%) on taxable income, advance-tax credit,
// dividend withholding line, related-party-disclosure pointer.
//
// === LAYER STATUS ===
//
// Like Form 1301, depends on the Phase D tax engine. Throws
// `Form1214EngineNotReady` until that engine ships.

import { withUser } from "@/lib/db/withUser";

export class Form1214EngineNotReady extends Error {
  constructor(reason: string) {
    super(
      `Form 1214 prep-pack requires the Phase D IL tax engine. Reason: ${reason}.`,
    );
    this.name = "Form1214EngineNotReady";
  }
}

export type Form1214Summary = {
  fiscalYear: number;
  businessVatId: string;
  legalName: string;
  revenue: {
    grossMinor: bigint;
    costOfGoodsSoldMinor: bigint;
    operatingExpensesMinor: bigint;
    operatingProfitMinor: bigint;
  };
  taxableIncomeMinor: bigint;
  corporateTaxRatePct: number; // 23 by default — <verify-this> annually
  taxLiabilityMinor: bigint;
  advanceTaxPaidMinor: bigint;
  netPayableMinor: bigint;
  ownerCompensation: {
    salariesMinor: bigint;
    drawsMinor: bigint;
    dividendsMinor: bigint;
    shareholderLoanBalanceMinor: bigint;
  };
  reviewFlags: Array<{ severity: "info" | "warn" | "error"; messageEn: string; messageHe: string }>;
};

export type GenerateForm1214Args = {
  userId: string;
  businessId: string;
  fiscalYear: number;
};

export type GenerateForm1214Result = {
  summary: Form1214Summary;
  pdfData: Buffer;
};

export async function generateForm1214PrepPack(
  args: GenerateForm1214Args,
): Promise<GenerateForm1214Result> {
  if (!Number.isInteger(args.fiscalYear) || args.fiscalYear < 2000) {
    throw new Error(
      `generateForm1214PrepPack: implausible fiscalYear ${args.fiscalYear}`,
    );
  }
  return withUser(args.userId, async (_tx) => {
    void _tx;
    void args.businessId;

    type EngineShape = {
      runEngineForUser?: (...rest: unknown[]) => Promise<unknown>;
    };
    const target = "@/lib/tax/il/runEngineForUser";
    let engineModule: EngineShape | null = null;
    try {
      const mod: unknown = await import(/* @vite-ignore */ target);
      engineModule = mod as EngineShape;
    } catch {
      engineModule = null;
    }
    if (!engineModule || typeof engineModule.runEngineForUser !== "function") {
      throw new Form1214EngineNotReady(
        "lib/tax/il/runEngineForUser not yet importable",
      );
    }

    throw new Form1214EngineNotReady(
      "engine present but Form 1214 integration not yet implemented (Phase D handoff TODO)",
    );
  });
}
