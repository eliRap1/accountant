// Form 856 — Annual withholding-tax report to suppliers (ניכוי מס במקור
// לספקים שנתי). The business reports for each supplier from whom it
// withheld income tax during the fiscal year.
//
// === SPEC SOURCE STATUS ===
//
// Sandbox WebFetch on 2026-05-16 was CF-blocked for the ITA WHT-856
// spec page. Public CPA-software references describe the file as a
// CSV (or XML, depending on submission channel) with one row per
// supplier × per-payment-type, including supplier ID, withholding
// percentage applied, gross, and withheld amount.
//
// <verify-this> CSV column order + XML schema URI before submission.
//
// === LAYER STATUS ===
//
// Reads from `supplier_wht_rates` (Layer 3 — not built) and aggregates
// transactions tagged with supplier-withholding metadata. Throws
// `Form856LayerNotReady` until Layer 3 lands.

import { withUser } from "@/lib/db/withUser";

export class Form856LayerNotReady extends Error {
  constructor() {
    super(
      "Form 856 requires supplier_wht_rates (Layer 3 — not yet built) and a per-supplier WHT-tagging path on transactions.",
    );
    this.name = "Form856LayerNotReady";
  }
}

export class Form856SpecNotVerified extends Error {
  constructor() {
    super(
      "Form 856 spec not verified against an ITA primary source on 2026-05-16.",
    );
    this.name = "Form856SpecNotVerified";
  }
}

export type GenerateForm856Args = {
  userId: string;
  businessId: string;
  fiscalYear: number;
  /** "csv" | "xml" — submission channel. */
  format?: "csv" | "xml";
  acknowledgeSpecUnverified?: boolean;
};

export type GenerateForm856Result = {
  file: Buffer;
  mimeType: string;
};

export async function generateForm856(
  args: GenerateForm856Args,
): Promise<GenerateForm856Result> {
  if (!args.acknowledgeSpecUnverified) {
    throw new Form856SpecNotVerified();
  }
  if (!Number.isInteger(args.fiscalYear) || args.fiscalYear < 2000) {
    throw new Error(`generateForm856: implausible fiscalYear ${args.fiscalYear}`);
  }
  const format = args.format ?? "csv";
  if (format !== "csv" && format !== "xml") {
    throw new Error(`generateForm856: format must be "csv" | "xml", got ${format}`);
  }
  return withUser(args.userId, async (_tx) => {
    void _tx;
    void args.businessId;
    throw new Form856LayerNotReady();
  });
}
