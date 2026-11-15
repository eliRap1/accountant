// Form 1301 — Annual personal tax return prep-pack (יחיד / individual
// self-employed). The actual filing is submitted by the user via the ITA
// portal; we generate a PRINTABLE PREP PACK only.
//
// === SPEC SOURCE STATUS ===
//
// Sandbox WebFetch on 2026-05-16 against gov.il for the Form 1301 PDF
// template was CF-blocked. We rely on the public ITA form structure
// (legal-name + tax-id header, income section, deduction section,
// credit-points section, tax-liability section, advance-tax credit
// section, net-payable line). The PDF rendering happens in Phase F via
// @react-pdf/renderer (already a dep); this module exports the SUMMARY
// object the renderer consumes, plus a placeholder pdfData Buffer.
//
// === LAYER STATUS ===
//
// Depends on Phase D `lib/tax/il/runEngineForUser.ts` which a sibling
// agent is writing concurrently. We import it lazily so this file
// type-checks without the dep present. If the engine isn't present at
// run time, `generateForm1301PrepPack` throws `Form1301EngineNotReady`.

import { withUser } from "@/lib/db/withUser";

export class Form1301EngineNotReady extends Error {
  constructor(reason: string) {
    super(
      `Form 1301 prep-pack requires the Phase D IL tax engine (lib/tax/il/runEngineForUser.ts). ` +
        `Reason: ${reason}. Wire once Phase D engine ships.`,
    );
    this.name = "Form1301EngineNotReady";
  }
}

export type Form1301Summary = {
  fiscalYear: number;
  businessVatId: string;
  legalName: string;
  income: {
    selfEmployedNetRevenueMinor: bigint;
    otherIncomeMinor: bigint;
    totalMinor: bigint;
  };
  deductions: {
    pensionContributionsMinor: bigint;
    keren_hishtalmutMinor: bigint;
    totalMinor: bigint;
  };
  creditPoints: number; // total credit points (נקודות זיכוי)
  taxableIncomeMinor: bigint;
  taxLiabilityBeforeCreditsMinor: bigint;
  taxLiabilityAfterCreditsMinor: bigint;
  advanceTaxPaidMinor: bigint;
  netPayableMinor: bigint; // positive = owed, negative = refund
  /**
   * Lines flagged for CPA review — e.g. credit-points the engine couldn't
   * verify from declared family status, or expense categories that lacked
   * a 6111 mapping. Surfaced as warnings on the printable prep pack.
   */
  reviewFlags: Array<{ severity: "info" | "warn" | "error"; messageEn: string; messageHe: string }>;
};

export type GenerateForm1301Args = {
  userId: string;
  businessId: string;
  fiscalYear: number;
};

export type GenerateForm1301Result = {
  summary: Form1301Summary;
  pdfData: Buffer;
};

/**
 * Generate a Form 1301 prep-pack. Currently throws `Form1301EngineNotReady`
 * because the Phase D engine isn't shipped. The body sketch below shows
 * the wiring that will land once `lib/tax/il/runEngineForUser.ts` exists.
 *
 *   const engine = await import("@/lib/tax/il/runEngineForUser");
 *   const result = await engine.runEngineForUser({ ... });
 *   const summary = buildSummary(result);
 *   const pdf = await renderForm1301Pdf(summary);
 *   return { summary, pdfData: pdf };
 */
export async function generateForm1301PrepPack(
  args: GenerateForm1301Args,
): Promise<GenerateForm1301Result> {
  if (!Number.isInteger(args.fiscalYear) || args.fiscalYear < 2000) {
    throw new Error(
      `generateForm1301PrepPack: implausible fiscalYear ${args.fiscalYear}`,
    );
  }
  return withUser(args.userId, async (_tx) => {
    void _tx;
    void args.businessId;

    // Try the engine. If the module is absent at runtime, treat as
    // "engine not ready" — keeps this generator safe to import from
    // anywhere even before Phase D code lands. We dynamic-import via an
    // indirection variable so TS doesn't bake the type of the target
    // module into this file (which would couple the build to Phase D).
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
      throw new Form1301EngineNotReady(
        "lib/tax/il/runEngineForUser not yet importable",
      );
    }

    // Engine present → integration code TBD; keep throw until it lands.
    throw new Form1301EngineNotReady(
      "engine present but Form 1301 integration not yet implemented (Phase D handoff TODO)",
    );
  });
}
