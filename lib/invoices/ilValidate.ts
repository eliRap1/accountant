// Israeli identifier checksum validators.
//
// Both ת.ז. (national ID / Teudat Zehut) and ח.פ. / ע.מ. (company /
// self-employed VAT ID) share the same 9-digit format with a checksum
// digit in position 9. The algorithm is identical to the Luhn variant
// the ITA documents publicly:
//
//   - Multiply digits 1..8 by alternating weights 1, 2, 1, 2, 1, 2, 1, 2.
//   - For each product, if it's > 9 sum its digits (e.g. 2 * 7 = 14 -> 1+4 = 5).
//   - Add all eight contributions PLUS the raw 9th digit.
//   - The total must be a multiple of 10.
//
// Sources cross-checked against the published ITA + Interior Ministry
// documents. Same algorithm regardless of whether the ID is a person's
// national ID, a company ח.פ., or a self-employed ע.מ. — the ITA uses
// the same numbering pool.
//
// Pure functions, no DB. Used for UI validation, ingest checks, and the
// optional osek-morshe registry pre-flight.

export const IL_ID_DIGITS = 9;

const DIGIT_RX = /\D/g;

/**
 * Strip every non-digit and left-pad with zeros to 9 characters. Returns
 * the cleaned string. Callers that received longer input should treat
 * that as invalid BEFORE calling normalize — we still pad for the common
 * "user typed 7 digits" case to make the checksum well-defined.
 */
export function normalizeIlId(input: string): string {
  if (typeof input !== "string") return "";
  const digitsOnly = input.replace(DIGIT_RX, "");
  if (digitsOnly.length > IL_ID_DIGITS) {
    // Caller passed too many digits — return as-is so the checksum step
    // can fail loudly rather than silently truncating.
    return digitsOnly;
  }
  return digitsOnly.padStart(IL_ID_DIGITS, "0");
}

function checksumIsValid(id9: string): boolean {
  if (id9.length !== IL_ID_DIGITS) return false;
  let sum = 0;
  for (let i = 0; i < IL_ID_DIGITS; i++) {
    const digitChar = id9.charAt(i);
    if (digitChar < "0" || digitChar > "9") return false;
    const digit = digitChar.charCodeAt(0) - 48;
    // Position 1 (index 0) weight 1, position 2 (index 1) weight 2, etc.
    // The 9th digit (index 8) is the check digit and contributes as-is.
    const weight = (i % 2) + 1;
    let product = digit * weight;
    if (product > 9) product -= 9; // equivalent to digit-sum for products in [10, 18]
    sum += product;
  }
  return sum % 10 === 0;
}

/**
 * Validate a 9-digit Israeli national ID (ת.ז.).
 *
 * Returns true only if `id` normalises cleanly to 9 digits AND passes the
 * checksum. Whitespace and dashes are tolerated; non-numeric content
 * elsewhere makes the input invalid.
 */
export function validateTeudatZehut(id: string): boolean {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (trimmed.length === 0) return false;
  // Reject inputs that contain anything but digits + the usual separators.
  if (/[^\d\s-]/.test(trimmed)) return false;
  const norm = normalizeIlId(trimmed);
  if (norm.length !== IL_ID_DIGITS) return false;
  // All-zero is technically checksum-valid but is not a real ID.
  if (norm === "000000000") return false;
  return checksumIsValid(norm);
}

/**
 * Validate a 9-digit Israeli ח.פ. (company) or ע.מ. (self-employed) ID.
 *
 * Same algorithm as ת.ז., but with one extra heuristic: ח.פ. IDs start
 * with `5` and ע.מ. IDs with `3` or `9` in the modern ITA scheme. We do
 * NOT enforce the leading-digit rule here — historical IDs predate the
 * scheme — but we do reject empty + all-zero. Callers that need the
 * stricter check can layer their own.
 */
export function validateVatId(id: string): boolean {
  // The checksum algorithm itself is identical, so delegate. We keep the
  // two functions distinct for caller clarity and for future divergence
  // (e.g. if ITA tightens the ע.מ. leading-digit rule we add it here).
  return validateTeudatZehut(id);
}
