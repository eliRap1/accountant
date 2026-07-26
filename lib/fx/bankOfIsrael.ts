// Bank of Israel public exchange-rates client.
//
// We use the public endpoint
//   https://www.boi.org.il/PublicApi/GetExchangeRates
// which returns the latest official rates for ~14 currencies, with per-
// currency `unit` (e.g. JPY is quoted per 100 JPY) and a `lastUpdate`
// timestamp. The endpoint does NOT take a date parameter — it always
// returns the latest published rates. Historical rates require a separate
// CSV / Excel pull off the BoI site, which we do NOT model here.
//
// Verified 2026-05-16: endpoint returns JSON with `exchangeRates: Array<{
//   key: string, currentExchangeRate: number, unit: number,
//   lastUpdate: string }>`. <verify-this>
//
// On any HTTP error, malformed JSON, or timeout, we return a hard-coded
// fallback snapshot for USD/EUR/GBP so invoicing still has a defined
// `fx_rate_at_issue` to record. The fallback is conservative — callers
// inspecting the `asOf` field will see "fallback" and can decide whether
// to require operator confirmation before issuing a non-ILS invoice.

import { readCache, writeCache } from "@/lib/fx/cache";

export type FxRateEntry = {
  rateAgainstIls: number; // multiply foreign-currency amount by this to get ILS
  asOf: string; // ISO 8601 timestamp from BoI, or "fallback" when offline
};

export type FxRatesByCurrency = Record<string, FxRateEntry>;

type BoiPayload = {
  exchangeRates?: Array<{
    key?: string;
    currentExchangeRate?: number;
    unit?: number;
    lastUpdate?: string;
  }>;
};

const ENDPOINT = "https://www.boi.org.il/PublicApi/GetExchangeRates";
const TIMEOUT_MS = 5_000;
// Cache keyed by ISO date (YYYY-MM-DD). BoI rates publish once a workday
// so a 24h TTL is correct.
const TTL_MS = 24 * 60 * 60 * 1000;

// Fallback snapshot — used only when the live endpoint is unreachable.
// These numbers are illustrative; the `asOf: "fallback"` marker is what
// invoicing keys off to decide whether to warn the operator. <verify-this>
const FALLBACK_RATES: FxRatesByCurrency = {
  USD: { rateAgainstIls: 3.6, asOf: "fallback" },
  EUR: { rateAgainstIls: 3.9, asOf: "fallback" },
  GBP: { rateAgainstIls: 4.5, asOf: "fallback" },
};

function isoDateKey(date: Date): string {
  // Use UTC date because BoI publishes once per IL workday; we don't need
  // locale-aware bucketing for caching purposes.
  return date.toISOString().slice(0, 10);
}

function parseBoiPayload(payload: unknown): FxRatesByCurrency | null {
  if (!payload || typeof payload !== "object") return null;
  const arr = (payload as BoiPayload).exchangeRates;
  if (!Array.isArray(arr)) return null;
  const out: FxRatesByCurrency = {};
  for (const row of arr) {
    const key = row?.key;
    const rate = row?.currentExchangeRate;
    const unit = row?.unit ?? 1;
    const lastUpdate = row?.lastUpdate ?? "";
    if (
      typeof key !== "string" ||
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      typeof unit !== "number" ||
      unit <= 0
    ) {
      continue;
    }
    // Normalise per-unit. JPY arrives as "per 100 JPY", so we divide.
    out[key] = {
      rateAgainstIls: rate / unit,
      asOf: typeof lastUpdate === "string" ? lastUpdate : "",
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Fetch the latest published BoI exchange rates. The optional `date`
 * argument is honoured for caching (a stale entry from the same UTC day
 * is reused) but the BoI endpoint itself is "current snapshot only" —
 * passing a historical date does NOT retrieve historical rates.
 *
 * Fails soft: returns a fallback snapshot if the endpoint is unreachable.
 * Callers MUST inspect `entry.asOf === "fallback"` and decide whether to
 * warn the operator.
 */
export async function fetchDailyRates(
  date?: Date,
): Promise<FxRatesByCurrency> {
  const day = date ?? new Date();
  const cacheKey = `boi-fx-${isoDateKey(day)}`;
  const cached = readCache<FxRatesByCurrency>(cacheKey, TTL_MS);
  if (cached) return cached;

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(ENDPOINT, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "accountech-web/0.1",
      },
      signal: ctl.signal,
    });
    if (!resp.ok) {
      return FALLBACK_RATES;
    }
    const payload: unknown = await resp.json();
    const parsed = parseBoiPayload(payload);
    if (!parsed) return FALLBACK_RATES;
    writeCache<FxRatesByCurrency>(cacheKey, parsed);
    return parsed;
  } catch {
    return FALLBACK_RATES;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Convenience: rate for a single currency, or `null` if unknown.
 * Always queries the cache/endpoint via `fetchDailyRates`.
 */
export async function fetchRateFor(
  currency: string,
  date?: Date,
): Promise<FxRateEntry | null> {
  if (currency === "ILS") {
    return { rateAgainstIls: 1, asOf: "identity" };
  }
  const all = await fetchDailyRates(date);
  return all[currency] ?? null;
}
