// PayPlus processor sync (Plan v4 Phase F.4 — receipts only).
//
// PayPlus has the most-documented IL processor API. From docs.payplus.co.il:
//   POST https://restapi.payplus.co.il/api/v1.0/Invoice/GetDocuments
//   Headers: `api-key: <key>`, `secret-key: <key>`
//   Body: { filter: { from_date, to_date }, transaction_uid? }
//   Response shape: not fully documented in the API reference excerpt —
//   we map against the conventional `results: Array<{...}>` shape and
//   flag the assumed field names with <verify-this:payplus-getdocuments-fields>.
//
// IMPORTANT: PayPlus uses TWO keys (api-key + secret-key). We expect the
// operator to paste the pair joined by ":" (e.g. "API_KEY:SECRET_KEY")
// in the single-line "API Key" field. The adapter splits on the first
// ":" to recover the two halves. If the operator pastes only one value
// we send a clearer error than HTTP 401.

import { fetchWithRetry, timeoutSignal, type ProcessorAdapter } from "./common";

const PAYPLUS_BASE =
  process.env["PAYPLUS_API_BASE"] ?? "https://restapi.payplus.co.il/api/v1.0";

type PayPlusDocApi = {
  uid: string; // PayPlus document UID
  document_date: string; // ISO yyyy-mm-dd
  total: number; // ILS major
  currency_code?: string;
  customer_name?: string;
  document_number?: string;
  document_type?: string;
};

type PayPlusGetDocumentsResponse = {
  results?: { status: string };
  data?: PayPlusDocApi[];
  total_count?: number;
};

function splitKeys(combined: string): { apiKey: string; secretKey: string } | null {
  const i = combined.indexOf(":");
  if (i < 0) return null;
  const apiKey = combined.slice(0, i).trim();
  const secretKey = combined.slice(i + 1).trim();
  if (!apiKey || !secretKey) return null;
  return { apiKey, secretKey };
}

export const payplusAdapter: ProcessorAdapter = {
  async testConnection(combined: string) {
    const keys = splitKeys(combined);
    if (!keys) {
      return {
        ok: false,
        message:
          "PayPlus expects two keys joined by ':' — paste 'API_KEY:SECRET_KEY' in the API key field.",
      };
    }
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetchWithRetry(
        `${PAYPLUS_BASE}/Invoice/GetDocuments`,
        {
          method: "POST",
          headers: {
            "api-key": keys.apiKey,
            "secret-key": keys.secretKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            filter: { from_date: today, to_date: today },
          }),
          signal: timeoutSignal(10_000),
        },
        2,
      );
      if (res.ok) {
        return {
          ok: true,
          message:
            "PayPlus credential accepted. <verify-this:payplus-getdocuments-fields>",
        };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "PayPlus rejected the API key / secret pair." };
      }
      return { ok: false, message: `PayPlus returned HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        message: `PayPlus connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async fetchReceipts({ apiKey: combined, since }) {
    const keys = splitKeys(combined);
    if (!keys) throw new Error("payplus.fetchReceipts: invalid combined key");
    const fromDate = since ?? "2020-01-01";
    const toDate = new Date().toISOString().slice(0, 10);
    const res = await fetchWithRetry(
      `${PAYPLUS_BASE}/Invoice/GetDocuments`,
      {
        method: "POST",
        headers: {
          "api-key": keys.apiKey,
          "secret-key": keys.secretKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          filter: { from_date: fromDate, to_date: toDate },
        }),
        signal: timeoutSignal(),
      },
    );
    if (!res.ok) {
      throw new Error(`payplus.fetchReceipts: HTTP ${res.status}`);
    }
    const body = (await res.json()) as PayPlusGetDocumentsResponse;
    const rows = (body.data ?? []).map((r) => ({
      externalId: `payplus:${r.uid}`,
      processor: "payplus" as const,
      issuedDate: r.document_date,
      amountMinor: BigInt(Math.round(r.total * 100)),
      currency: r.currency_code ?? "ILS",
      customerLabel: r.customer_name ?? "",
      receiptNumber: r.document_number,
      rawMetadata: r as unknown as Record<string, unknown>,
    }));
    // PayPlus does not guarantee result ordering; the cursor must be
    // the MAX issuedDate across rows or the next run regresses to
    // earlier dates and re-fetches the same window forever.
    const maxDate = rows.reduce<string | null>((acc, r) => {
      if (!r.issuedDate) return acc;
      return acc === null || r.issuedDate > acc ? r.issuedDate : acc;
    }, null);
    return { rows, nextCursor: maxDate };
  },
};
