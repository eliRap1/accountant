// ITA business-registry lookup (osek-morshe / osek-patur search).
//
// The Israeli Tax Authority publishes a public lookup endpoint that lets
// you query a VAT ID (ע.מ. / ח.פ.) and get back the registered legal
// name + activity status. We use this as a soft pre-flight check when an
// operator adds a new client — "the ITA says this ID belongs to a
// different name; want to overwrite?" — but we NEVER block invoicing on
// it. The ITA endpoint is rate-limited and frequently 503s.
//
// Endpoint guess: https://secapp.taxes.gov.il/srv/eosekmorshe/main.aspx
// — verified 2026-05-16 to return 503 to automated fetch. Until the real
// JSON shape is documented or reverse-engineered we ship this as a stub
// that consistently returns `{status: "unknown", source: "unavailable"}`
// for any input. Phase F.4 will swap in the real client. <verify-this>
//
// Fail-soft contract: never throws, never blocks. 5-second timeout.
//
// Cache: 24-hour JSON-file cache via `lib/fx/cache.ts`. Phase F moves
// this to a Postgres `osek_morshe_cache` table — see code comments.

import { readCache, writeCache } from "@/lib/fx/cache";
import { validateVatId, normalizeIlId } from "@/lib/invoices/ilValidate";

export type OsekMorsheLookupResult = {
  /** Registered legal name, if returned. */
  name?: string;
  /** Activity status. `unknown` covers both "not in registry" and "endpoint down". */
  status?: "active" | "inactive" | "unknown";
  /** Where the result came from — drives UI confidence display. */
  source: "ita" | "cache" | "unavailable";
};

const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5_000;
// Phase F.4 will replace with the verified canonical URL.
const ITA_ENDPOINT = "https://secapp.taxes.gov.il/srv/eosekmorshe/main.aspx";

async function callItaEndpoint(
  _vatId: string,
): Promise<OsekMorsheLookupResult | null> {
  // The endpoint shape (query params, response JSON/HTML) is undocumented
  // and returned 503 to automated fetch on 2026-05-16. The implementation
  // below probes liveness only; on any non-200 OR on parse failure we
  // return null so the caller falls through to "unavailable". <verify-this>
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(ITA_ENDPOINT, {
      method: "GET",
      headers: {
        accept: "text/html,application/json",
        "user-agent": "accountech-web/0.1",
      },
      signal: ctl.signal,
    });
    if (!resp.ok) return null;
    // Until the real schema is reverse-engineered the parsed payload is
    // not interpretable. Treat as "no data" so callers fall through to
    // the fail-soft branch without blocking.
    await resp.text();
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Look up an Israeli VAT ID against the ITA registry. Never throws.
 *
 * Order of operations:
 *   1. Validate input. Invalid checksum returns immediately with
 *      `source: "unavailable"` — no point burning a registry call.
 *   2. Hit the 24h JSON-file cache. Phase F replaces with Postgres.
 *   3. Call the ITA endpoint. On any failure return "unavailable".
 *
 * NOTE: The current implementation is a stub. The endpoint shape is
 * undocumented and the live endpoint 503s; we ship the stub so the UI
 * surface (Phase C client form) can already render "ITA lookup
 * unavailable" without runtime errors. <verify-this> the real URL +
 * schema before turning this into a hard pre-flight check.
 */
export async function osekMorsheLookup(
  vatId: string,
): Promise<OsekMorsheLookupResult> {
  const normalised = normalizeIlId(vatId);
  if (!validateVatId(normalised)) {
    return { status: "unknown", source: "unavailable" };
  }

  const cacheKey = `osek-${normalised}`;
  const cached = readCache<OsekMorsheLookupResult>(cacheKey, TTL_MS);
  if (cached) {
    return { ...cached, source: "cache" };
  }

  const live = await callItaEndpoint(normalised);
  if (!live) {
    // Don't cache the "unavailable" verdict — we want the next call to
    // re-attempt rather than serve stale offline status for 24h.
    return { status: "unknown", source: "unavailable" };
  }

  writeCache<OsekMorsheLookupResult>(cacheKey, live);
  return { ...live, source: "ita" };
}
