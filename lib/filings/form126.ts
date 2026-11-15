// Form 126 — Annual unified employee tax certificate (טופס 126 מאוחד).
//
// When a single Israeli taxpayer has more than one employer in the same
// fiscal year, Form 126 reconciles the combined income-tax position so
// the secondary employer's flat-rate withholding doesn't leave the
// employee under- or over-withheld.
//
// === SPEC SOURCE STATUS ===
//
// Sandbox WebFetch on 2026-05-16 against the ITA payroll-spec portal was
// CF-blocked. The format is widely-documented as a fixed-width text file
// per the ITA's payroll software vendor pack, but the canonical column
// table was not retrieved.
//
// === LAYER STATUS ===
//
// Depends on Layer-3 payroll tables (payroll_runs, payroll_employees,
// form_101_declarations). Until those exist this module throws.

import { withUser } from "@/lib/db/withUser";

export class Form126LayerNotReady extends Error {
  constructor() {
    super(
      "Form 126 requires payroll_runs / payroll_employees / form_101_declarations (Layer 3 — not yet built).",
    );
    this.name = "Form126LayerNotReady";
  }
}

export class Form126SpecNotVerified extends Error {
  constructor() {
    super(
      "Form 126 byte-level spec not verified against an ITA primary source on 2026-05-16.",
    );
    this.name = "Form126SpecNotVerified";
  }
}

export type GenerateForm126Args = {
  userId: string;
  businessId: string;
  fiscalYear: number;
  acknowledgeSpecUnverified?: boolean;
};

/**
 * Stub. Throws unconditionally — see header. Public shape preserved so
 * Phase F can already wire a UI button pointing here.
 */
export async function generateForm126(
  args: GenerateForm126Args,
): Promise<Buffer> {
  if (!args.acknowledgeSpecUnverified) {
    throw new Form126SpecNotVerified();
  }
  if (!Number.isInteger(args.fiscalYear) || args.fiscalYear < 2000) {
    throw new Error(`generateForm126: implausible fiscalYear ${args.fiscalYear}`);
  }
  return withUser(args.userId, async (_tx) => {
    void _tx;
    void args.businessId;
    throw new Form126LayerNotReady();
  });
}
