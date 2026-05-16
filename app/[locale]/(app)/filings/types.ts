// Types + sync helpers for the filings module. Lives in a sibling file
// because actions.ts has `"use server"` which forbids non-async exports
// (Turbopack: "Server Actions must be async functions" otherwise).

import type { StepUpOp } from "@/lib/auth/stepUp";

export type FilingKind =
  | "pcn874"
  | "form_6111"
  | "form_102"
  | "form_1301"
  | "form_1214"
  | "form_126"
  | "form_856";

export type FilingActionResult =
  | { ok: true; id: string }
  | { error: string }
  | { stepUpRequired: { op: string; payloadHash: string } };

/** Map a filing kind to a step-up op symbol from `STEP_UP_OPS`. */
export function mapStepUpOpForKind(kind: FilingKind): StepUpOp {
  switch (kind) {
    case "pcn874":
      return "filing.export_pcn874";
    case "form_6111":
    case "form_126":
    case "form_856":
      // 126/856 currently route through the form6111 op until they are
      // listed in STEP_UP_OPS. Same risk class (annual filing export).
      return "filing.export_form6111";
    case "form_102":
      return "filing.export_form102";
    case "form_1301":
      return "filing.export_form1301";
    case "form_1214":
      return "filing.export_form1214";
  }
}

export type FilingPreview = {
  invoiceCount: number;
  sumPreVatMinor: string;
  sumVatMinor: string;
};
