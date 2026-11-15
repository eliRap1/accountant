// Form 102 — Bituach Leumi monthly employer report.
//
// === SPEC SOURCE STATUS ===
//
// Sandbox WebFetch attempts on 2026-05-16 against https://www.btl.gov.il/
// Insurance/Self_Employed_Insurance and the BTL "טפסים למעסיק" portal all
// timed out or were blocked. No authoritative format obtained.
//
// Public BTL software-vendor docs describe Form 102 as a monthly XLSX OR
// CSV (per employer size — XLSX for ≤10 employees, CSV/positional for
// larger payrolls). The required columns include:
//   - employer "תיק ניכויים" (income-tax withholding file)
//   - report month YYYYMM
//   - per-employee: ID (תעודת זהות), gross, BTL employee class,
//     BTL employer share, BTL employee share, sickness/maternity
//
// <verify-this> The exact column order + the precise version of the
// monthly XLSX template MUST be reconfirmed before any real submission.
//
// === LAYER STATUS ===
//
// `payroll_runs` and `payroll_employees` (schema Layer 3) are not yet
// built. This module therefore throws `LayerNotReady` on every call.
// Once Layer 3 ships, swap the throw for a real builder mirroring
// pcn874.ts' driver pattern.

import { withUser } from "@/lib/db/withUser";

export class Form102LayerNotReady extends Error {
  constructor() {
    super(
      "Form 102 generator requires payroll_runs + payroll_employees tables (schema Layer 3). " +
        "Those tables are not yet defined in db/schema/. Refer to plan v4 § P2 payroll list.",
    );
    this.name = "Form102LayerNotReady";
  }
}

export class Form102SpecNotVerified extends Error {
  constructor() {
    super(
      "Form 102 byte/column-level spec not verified against a BTL primary source on 2026-05-16. " +
        "Refusing to generate a filing that may be rejected on submission.",
    );
    this.name = "Form102SpecNotVerified";
  }
}

export type GenerateForm102Args = {
  userId: string;
  businessId: string;
  /** "YYYY-MM" — month being reported (paid wages window). */
  periodLabel: string;
  acknowledgeSpecUnverified?: boolean;
};

export type GenerateForm102Result = {
  file: Buffer;
  mimeType: string;
};

/**
 * Generate a Form 102 file for a single month. Currently throws
 * `Form102LayerNotReady` unconditionally — see header comment.
 *
 * The signature is reserved so consumers can type-check against it
 * today and swap the implementation in once Layer 3 lands.
 */
export async function generateForm102(
  args: GenerateForm102Args,
): Promise<GenerateForm102Result> {
  if (!args.acknowledgeSpecUnverified) {
    throw new Form102SpecNotVerified();
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.periodLabel)) {
    throw new Error(
      `generateForm102: periodLabel must be "YYYY-MM", got ${JSON.stringify(args.periodLabel)}`,
    );
  }

  // Touching withUser so the type-checker confirms the call signature is
  // already correct even though we throw before reading any rows.
  return withUser(args.userId, async (_tx) => {
    void _tx;
    void args.businessId;
    throw new Form102LayerNotReady();
  });
}
