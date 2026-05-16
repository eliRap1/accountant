// Shared types + retry/backoff helper for processor-sync (Plan v4 Phase
// F.4 — RESCOPED to receipts/קבלות).
//
// Every processor adapter (hyp/grow/payplus) implements `fetchReceipts`
// returning a normalised `ProcessorReceipt[]`. We don't try to be
// payment-method-agnostic here — the goal is "fetch the receipts the
// processor issued to my customers, so we can pair them with my
// internal invoices".

export type ProcessorReceipt = {
  // Stable processor-side id. Becomes our `source_external_id`. We
  // namespace by processor (`hyp:<id>`) in the dedup column so two
  // processors can't collide on numeric counters.
  externalId: string;
  processor: "hyp" | "grow" | "payplus";
  // ISO yyyy-mm-dd.
  issuedDate: string;
  // Amount the processor recorded. Signed positive (we never sync a
  // negative receipt — refunds become their own receipt rows).
  amountMinor: bigint;
  currency: string;
  // Customer label the processor showed on the receipt. Best-effort —
  // may be a card-holder string, an email, or a business name. The
  // pairer matches against (amount, date, customer) so consistency
  // matters more than precision.
  customerLabel: string;
  // Receipt number printed on the document (קבלה #1234).
  receiptNumber?: string | undefined;
  // Free-form metadata the processor included. Stored in
  // receipts.metadata_jsonb so it's queryable post-hoc but doesn't
  // need a schema column today.
  rawMetadata?: Record<string, unknown> | undefined;
};

export type ProcessorAdapter = {
  // Test the credential. Returns boolean OK + a free-form message the
  // UI can surface. Never throws — connection failures must round-trip
  // as `ok=false`.
  testConnection: (apiKey: string) => Promise<{ ok: boolean; message: string }>;
  // Fetch receipts issued AFTER `since` (cursor). Returns the rows and
  // a NEW cursor to persist. The cursor is processor-defined — for
  // most processors it's just the latest receipt timestamp.
  fetchReceipts: (args: {
    apiKey: string;
    since?: string | undefined;
  }) => Promise<{ rows: ProcessorReceipt[]; nextCursor: string | null }>;
};

// Retry with exponential backoff + jitter. Standard pattern: 250 ms, 500
// ms, 1 s, 2 s, give up. We deliberately stop at 4 retries (5 attempts)
// — the cron will retry the whole sync in an hour anyway, and a longer
// per-call retry just lengthens lock times.
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 5,
): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      // Retry on 5xx + 429. 4xx other than 429 is a credential / shape
      // problem and not worth retrying.
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastErr = err;
    }
    // Don't sleep after the last attempt — it's pointless and adds
    // latency to the cron run.
    if (i === attempts - 1) break;
    const baseMs = 250 * 2 ** i;
    const jitter = Math.floor(Math.random() * 100);
    await new Promise((r) => setTimeout(r, baseMs + jitter));
  }
  throw lastErr ?? new Error(`fetchWithRetry: gave up after ${attempts} attempts`);
}

// AbortSignal-bound timeout (default 30 s — long enough for slow IL
// processors but short enough to stay well under Vercel's 60-s function
// budget when called from the cron).
export function timeoutSignal(ms = 30_000): AbortSignal {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(new Error(`timed out after ${ms}ms`)), ms).unref?.();
  return ctl.signal;
}
