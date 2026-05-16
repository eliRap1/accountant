// Receipt-to-invoice pairer (Plan v4 Phase F.4).
//
// After fetching receipts from a processor, we try to match each one
// to an existing internal invoice. Match key: (amount_minor, issued_date
// within ±2 days, customer_label similar to client legal_name).
//
// Unpaired receipts get inserted into `receipts` with
// `source = 'processor_sync'` and surfaced to the operator under
// processor-sync/page.tsx so they can be linked to a client manually
// or filed as a standalone receipt.
//
// We deliberately do NOT auto-link receipts to invoices in the
// transactions table. The pairer's `match` flag is a HINT to the UI —
// the operator confirms the link.

import { sql } from "drizzle-orm";
import type { DrizzleTx } from "@/lib/invoices/sequential";
import {
  normalizeCounterparty,
} from "@/lib/recon/dedup";
import type { ProcessorReceipt } from "./common";

export type PairingResult = {
  receipt: ProcessorReceipt;
  // The invoice we believe this receipt belongs to. Null = orphan.
  matchedInvoiceId: string | null;
  // Reason we did/didn't match — surfaced to the operator.
  reason: "exact" | "amount_date" | "no_match" | "ambiguous";
};

type InvoiceCandidate = {
  id: string;
  totalMinor: string;
  issueDate: string;
  clientName: string | null;
};

function dateDiffDays(a: string, b: string): number {
  const aMs = new Date(`${a}T00:00:00Z`).getTime();
  const bMs = new Date(`${b}T00:00:00Z`).getTime();
  return Math.floor(Math.abs(aMs - bMs) / 86_400_000);
}

// String similarity for customer-label vs client-name. We use a
// normalised-token Jaccard score — simple, no dep, good enough for
// "Acme Ltd" vs "אקמה בע״מ" + "Acme" cases. Strict equality after
// normalizeCounterparty() is the canonical pass; the Jaccard score
// gates the looser fallback.
function tokenJaccard(a: string, b: string): number {
  const tokA = new Set(
    normalizeCounterparty(a).split(/\s+/).filter((t) => t.length >= 2),
  );
  const tokB = new Set(
    normalizeCounterparty(b).split(/\s+/).filter((t) => t.length >= 2),
  );
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let inter = 0;
  for (const t of tokA) if (tokB.has(t)) inter++;
  const union = tokA.size + tokB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Match a batch of receipts against the business's existing invoices.
 * Returns a result per receipt; commit decisions are made by the caller.
 */
export async function pairReceipts(args: {
  tx: DrizzleTx;
  businessId: string;
  receipts: ProcessorReceipt[];
}): Promise<PairingResult[]> {
  const { tx, businessId, receipts } = args;
  if (receipts.length === 0) return [];

  // Pull every candidate invoice within the date window of ANY receipt
  // in a single query. We don't try to do per-receipt filtering at the
  // SQL layer because (a) the IN list would be long, (b) the dataset
  // is small (a business issues a few hundred invoices a year, max).
  const dates = receipts.map((r) => r.issuedDate).sort();
  const minDate = dates[0]!;
  const maxDate = dates[dates.length - 1]!;
  // Widen the SQL window by ±2 days (the match tolerance).
  const widenMin = new Date(`${minDate}T00:00:00Z`);
  widenMin.setUTCDate(widenMin.getUTCDate() - 2);
  const widenMax = new Date(`${maxDate}T00:00:00Z`);
  widenMax.setUTCDate(widenMax.getUTCDate() + 2);
  const widenMinIso = widenMin.toISOString().slice(0, 10);
  const widenMaxIso = widenMax.toISOString().slice(0, 10);

  const candidates = (await tx.execute(
    sql`SELECT i.id::text AS id,
               i.total_minor::text AS "totalMinor",
               i.issue_date::text AS "issueDate",
               c.legal_name AS "clientName"
          FROM invoices i
          LEFT JOIN clients c ON c.id = i.client_id
         WHERE i.business_id = ${businessId}::uuid
           AND i.deleted_at IS NULL
           AND i.cancelled_at IS NULL
           AND i.issue_date BETWEEN ${widenMinIso}::date AND ${widenMaxIso}::date`,
  )) as unknown as InvoiceCandidate[];

  const out: PairingResult[] = [];
  for (const receipt of receipts) {
    const amountStr = receipt.amountMinor.toString();
    const sameAmount = candidates.filter((c) => c.totalMinor === amountStr);
    if (sameAmount.length === 0) {
      out.push({ receipt, matchedInvoiceId: null, reason: "no_match" });
      continue;
    }
    const withinWindow = sameAmount.filter(
      (c) => dateDiffDays(c.issueDate, receipt.issuedDate) <= 2,
    );
    if (withinWindow.length === 0) {
      out.push({ receipt, matchedInvoiceId: null, reason: "no_match" });
      continue;
    }
    // Score by customer-name similarity. If exactly one candidate hits
    // ≥0.5 Jaccard, it's a clean match. Multiple high-score candidates
    // → ambiguous, leave to operator.
    const scored = withinWindow
      .map((c) => ({
        candidate: c,
        score: tokenJaccard(receipt.customerLabel, c.clientName ?? ""),
      }))
      .sort((a, b) => b.score - a.score);
    const top = scored[0]!;
    if (top.score >= 0.5) {
      // Confirm uniqueness — if a second candidate is within 0.1 of the
      // top score, treat as ambiguous.
      if (scored.length > 1 && top.score - scored[1]!.score < 0.1) {
        out.push({ receipt, matchedInvoiceId: null, reason: "ambiguous" });
        continue;
      }
      out.push({
        receipt,
        matchedInvoiceId: top.candidate.id,
        reason: "exact",
      });
    } else if (withinWindow.length === 1) {
      // Single amount+date match without customer-name signal — treat
      // as amount_date match.
      out.push({
        receipt,
        matchedInvoiceId: top.candidate.id,
        reason: "amount_date",
      });
    } else {
      out.push({ receipt, matchedInvoiceId: null, reason: "ambiguous" });
    }
  }
  return out;
}
