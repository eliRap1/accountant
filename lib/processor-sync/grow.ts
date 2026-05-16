// Grow Payments processor sync (Plan v4 Phase F.4 — receipts only).
//
// <verify-this:grow-receipts-endpoint> Grow Payments (formerly Meshulam,
// now at developers.grow.business after the readme.io redirect) has a
// REST API but the receipts/קבלות endpoint is not publicly listed on
// the reference index. Based on community references the assumed shape:
//   GET https://app.grow.business/api/payments?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Header: Authorization: <api-key> (note: no "Bearer" prefix per legacy convention)
// Each payment row includes the auto-generated receipt PDF link.
//
// Until we have access to a sandbox, this adapter stubs the response
// shape. testConnection() does a HEAD-ish probe so the operator gets
// feedback in the UI without burning the API quota.

import { fetchWithRetry, timeoutSignal, type ProcessorAdapter } from "./common";

const GROW_BASE = process.env["GROW_API_BASE"] ?? "https://app.grow.business/api";

type GrowReceiptApi = {
  asmachta: string; // אסמכתא = stable processor-side id
  paymentDate: string; // ISO yyyy-mm-dd
  sum: number; // ILS major
  currency?: string;
  customerName?: string;
  documentNumber?: string;
};

type GrowReceiptsResponse = {
  data: GrowReceiptApi[];
  total: number;
  hasMore: boolean;
};

export const growAdapter: ProcessorAdapter = {
  async testConnection(apiKey: string) {
    try {
      const res = await fetchWithRetry(
        `${GROW_BASE}/payments?limit=1`,
        {
          method: "GET",
          headers: { authorization: apiKey },
          signal: timeoutSignal(10_000),
        },
        2,
      );
      if (res.ok) {
        return {
          ok: true,
          message: "Grow credential accepted. <verify-this:grow-receipts-endpoint>",
        };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Grow rejected the API key." };
      }
      return { ok: false, message: `Grow returned HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        message: `Grow connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async fetchReceipts({ apiKey, since }) {
    const qs = new URLSearchParams();
    if (since) qs.set("from", since);
    const res = await fetchWithRetry(
      `${GROW_BASE}/payments?${qs.toString()}`,
      {
        method: "GET",
        headers: { authorization: apiKey },
        signal: timeoutSignal(),
      },
    );
    if (!res.ok) {
      throw new Error(`grow.fetchReceipts: HTTP ${res.status}`);
    }
    const body = (await res.json()) as GrowReceiptsResponse;
    const rows = (body.data ?? []).map((r) => ({
      externalId: `grow:${r.asmachta}`,
      processor: "grow" as const,
      issuedDate: r.paymentDate,
      amountMinor: BigInt(Math.round(r.sum * 100)),
      currency: r.currency ?? "ILS",
      customerLabel: r.customerName ?? "",
      receiptNumber: r.documentNumber,
      rawMetadata: r as unknown as Record<string, unknown>,
    }));
    // Grow paginates via hasMore — for the MVP cron we fetch only the
    // first page and let the next cron run pick up the rest. Take the
    // MAX issuedDate as the cursor (rather than the last row), since
    // Grow does not guarantee result ordering and an un-sorted "last
    // row" with the earliest date would make the cursor regress.
    const maxDate = rows.reduce<string | null>((acc, r) => {
      if (!r.issuedDate) return acc;
      return acc === null || r.issuedDate > acc ? r.issuedDate : acc;
    }, null);
    return { rows, nextCursor: body.hasMore && maxDate ? maxDate : null };
  },
};
