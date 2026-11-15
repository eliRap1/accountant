// Fixed-width-record helpers for IL tax filings.
//
// PCN874 (Form 874 — "דיווח מקוון של עוסקים") and Form 102 (Bituach Leumi
// monthly) are line-oriented fixed-width formats. Every field has a
// declared width in characters (NOT bytes — windows-1255 is single-byte
// per Hebrew/Latin char so it works out the same, but the spec talks
// in characters).
//
// Functions in this file are PURE and self-contained:
//   - no DB, no IO
//   - no Buffer (string-level only — encoding to windows-1255 happens
//     downstream in `windows1255.ts`)
//   - throw on width violations rather than silently truncating data
//     that would land in the wrong column on the wire.
//
// Spec source: see top-of-file note in `pcn874.ts` — fetch failed from
// sandbox on 2026-05-16, marked <verify-this> until ITA primary doc is
// confirmed.

/**
 * Pad `value` on the LEFT with `char` to exactly `width` characters.
 * Throws if `value` is already wider than `width` (refusing to truncate
 * silently — caller must `truncate()` first if they meant to).
 */
export function padLeft(
  value: string | number | bigint,
  width: number,
  char: string = "0",
): string {
  if (char.length !== 1) {
    throw new Error(
      `padLeft: pad char must be exactly 1 character, got ${JSON.stringify(char)}`,
    );
  }
  if (!Number.isInteger(width) || width < 0) {
    throw new Error(`padLeft: width must be a non-negative integer, got ${width}`);
  }
  const str = String(value);
  if (str.length > width) {
    throw new Error(
      `padLeft: value ${JSON.stringify(str)} is wider than declared width ${width}`,
    );
  }
  return char.repeat(width - str.length) + str;
}

/**
 * Pad `value` on the RIGHT with `char` to exactly `width` characters.
 * Throws if `value` is already wider than `width`.
 */
export function padRight(
  value: string | number | bigint,
  width: number,
  char: string = " ",
): string {
  if (char.length !== 1) {
    throw new Error(
      `padRight: pad char must be exactly 1 character, got ${JSON.stringify(char)}`,
    );
  }
  if (!Number.isInteger(width) || width < 0) {
    throw new Error(`padRight: width must be a non-negative integer, got ${width}`);
  }
  const str = String(value);
  if (str.length > width) {
    throw new Error(
      `padRight: value ${JSON.stringify(str)} is wider than declared width ${width}`,
    );
  }
  return str + char.repeat(width - str.length);
}

/**
 * Truncate `value` to at most `width` characters. Returns `value` unchanged
 * if shorter. Use only for free-text fields where spec explicitly allows
 * truncation (e.g. description columns) — NEVER for IDs or amounts.
 */
export function truncate(value: string | number | bigint, width: number): string {
  if (!Number.isInteger(width) || width < 0) {
    throw new Error(`truncate: width must be a non-negative integer, got ${width}`);
  }
  const str = String(value);
  return str.length <= width ? str : str.slice(0, width);
}

/**
 * Assert that `value.length === width`. Throws a labelled error otherwise.
 * Used at the end of each record-build to catch arithmetic mistakes before
 * bytes leave the process.
 */
export function assertExactWidth(
  value: string,
  width: number,
  label: string,
): void {
  if (!Number.isInteger(width) || width < 0) {
    throw new Error(
      `assertExactWidth: width must be a non-negative integer, got ${width}`,
    );
  }
  if (value.length !== width) {
    throw new Error(
      `assertExactWidth: field ${JSON.stringify(label)} expected width ${width}, got ${value.length} (value: ${JSON.stringify(value)})`,
    );
  }
}

/**
 * Format a signed integer amount (in minor units / agorot) for IL filing
 * fields. The spec varies per field; this helper covers the COMMON case:
 *   - amount is non-negative
 *   - rendered as zero-padded fixed-width digits, no decimal point, no sign
 *
 * For signed fields (refunds etc.) the spec uses a leading '+' or '-' in
 * a separate sign column; pcn874.ts handles that separately.
 *
 * Throws on negative input (caller must split into sign + magnitude first).
 */
export function formatAmountMinor(amountMinor: bigint, width: number): string {
  if (amountMinor < 0n) {
    throw new Error(
      `formatAmountMinor: expected non-negative amount, got ${amountMinor}`,
    );
  }
  return padLeft(amountMinor.toString(), width, "0");
}

/**
 * Format a YYYYMMDD date stamp common across IL tax filings. `date` must
 * be a Date object representing a calendar date (UTC components are used
 * directly — caller is responsible for tz alignment).
 */
export function formatDateYYYYMMDD(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatDateYYYYMMDD: invalid Date`);
  }
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${padLeft(y, 4, "0")}${padLeft(m, 2, "0")}${padLeft(d, 2, "0")}`;
}
