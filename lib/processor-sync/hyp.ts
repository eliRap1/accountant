// Hyp processor sync (Plan v4 Phase F.4 — receipts only).
//
// <verify-this:hyp-receipts-endpoint> Hyp's public docs at
// https://developers.hyp.co.il only describe their XML payment
// gateway (`doDeal`) and DO NOT publish a documented endpoint for
// fetching the קבלות they issued. The Hyp Pay product (the Apiary docs)
// confirms electronic receipts (kabalot) are generated automatically
// but does not list a receipts-listing API.
//
// We stub the adapter against an ASSUMED REST shape based on patterns
// from other IL processors:
//   GET https://api.hyp.co.il/v2/receipts?since=<iso8601>&page=<n>
//   Authorization: Bearer <api-key>
// The contract is parked behind the <verify-this> flag; the cron will
// surface the connection failure to the operator until Hyp confirms
// the real endpoint (sales@hyp.co.il can route this).

import { fetchWithRetry, timeoutSignal, type ProcessorAdapter } from "./common";

const HYP_BASE = process.env["HYP_API_BASE"] ?? "https://api.hyp.co.il/v2";

type HypReceiptApi = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  amount: number; // ILS major-unit
  currency?: string;
  customer_name?: string;
  receipt_number?: string;
  // Pagination cursor from server.
  cursor?: string;
};

type HypReceiptsResponse = {
  data: HypReceiptApi[];
  next_cursor?: string | null;
};

export const hypAdapter: ProcessorAdapter = {
  async testConnection(apiKey: string) {
    try {
      const res = await fetchWithRetry(
        `${HYP_BASE}/receipts?limit=1`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${apiKey}` },
          signal: timeoutSignal(10_000),
        },
        2,
      );
      if (res.ok) {
        return {
          ok: true,
          message: "Hyp credential accepted. <verify-this:hyp-receipts-endpoint>",
        };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Hyp rejected the API key." };
      }
      if (res.status === 404) {
        return {
          ok: false,
          message:
            "Hyp endpoint not found. The receipts API is not yet documented — contact Hyp support.",
        };
      }
      return { ok: false, message: `Hyp returned HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        message: `Hyp connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async fetchReceipts({ apiKey, since }) {
    const qs = new URLSearchParams();
    if (since) qs.set("since", since);
    const res = await fetchWithRetry(
      `${HYP_BASE}/receipts?${qs.toString()}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
        signal: timeoutSignal(),
      },
    );
    if (!res.ok) {
      throw new Error(`hyp.fetchReceipts: HTTP ${res.status}`);
    }
    const body = (await res.json()) as HypReceiptsResponse;
    const rows = (body.data ?? []).map((r) => ({
      externalId: `hyp:${r.id}`,
      processor: "hyp" as const,
      issuedDate: r.date,
      amountMinor: BigInt(Math.round(r.amount * 100)),
      currency: r.currency ?? "ILS",
      customerLabel: r.customer_name ?? "",
      receiptNumber: r.receipt_number,
      rawMetadata: r as unknown as Record<string, unknown>,
    }));
    return { rows, nextCursor: body.next_cursor ?? null };
  },
};
