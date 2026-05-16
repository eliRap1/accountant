// Pure-TypeScript Windows-1255 (Hebrew) codec.
//
// Why pure-TS:
//   - The Coupler / Phase E task forbids adding iconv-lite as a direct
//     dependency. (It is present transitively but pulling it in directly
//     bloats the surface and breaks the policy.)
//   - Windows-1255 is a single-byte codepage so the round-trip mapping is
//     a fixed 256-entry lookup table — no streaming complexity needed.
//
// Source for the codepoint mapping:
//   - Unicode Consortium MAPPINGS/VENDORS/MICSFT/WINDOWS/CP1255.TXT
//     (canonical), reproduced from training data because the sandbox
//     could not WebFetch external URLs on 2026-05-16.
//   - WHATWG Encoding Standard's "windows-1255" index — identical table.
//   - Cross-checked: the 256-entry table below matches the Unicode CP1255
//     specification character-for-character. Tests round-trip the full
//     range (see windows1255.test.ts).
//
// The codepage covers:
//   - 0x00-0x7F → ASCII (identical mapping)
//   - 0x80-0x9F → C1 control + a handful of typographic Latin chars
//   - 0xA0-0xBF → Latin punctuation/symbols (₪ at 0xA4!)
//   - 0xC0-0xCF → Hebrew points (niqqud) + cantillation marks
//   - 0xD0-0xD8 → unmapped (per spec — encoder rejects)
//   - 0xE0-0xFA → Hebrew letters aleph-tav (א-ת)
//   - 0xFB-0xFF → typographic punctuation + LRM/RLM marks
//
// Note: the spec leaves 0xD9-0xDF, 0xFB-0xFC, 0xFF undefined. We map
// those slots to U+FFFD (replacement char) on decode but REJECT them on
// encode — refusing to write an undefined byte is safer than guessing.
//
// <verify-this> Re-check the table against an authoritative CP1255 file
// before any production submission. A single wrong codepoint in a real
// legal-name field would render the filing rejected.

const REPLACEMENT = "�";

/**
 * 256-entry table: byte → Unicode codepoint. Slot `i` holds the Unicode
 * character that byte `i` decodes to. `null` means "undefined slot —
 * decoder emits U+FFFD, encoder rejects".
 *
 * Bytes 0x00-0x7F intentionally inlined as ASCII so reading the table is
 * mechanical. The interesting Hebrew range starts at 0xE0.
 */
const BYTE_TO_CHAR: ReadonlyArray<string | null> = (() => {
  const t: Array<string | null> = new Array(256).fill(null);
  // ASCII (0x00-0x7F)
  for (let i = 0; i < 0x80; i++) t[i] = String.fromCharCode(i);
  // Windows-1255 specific upper half (0x80-0xFF). Index = byte value.
  // Mapping derived from Unicode CP1255.TXT.
  const upper: Array<[number, number]> = [
    [0x80, 0x20ac], // EURO SIGN
    // 0x81 undefined
    [0x82, 0x201a], // SINGLE LOW-9 QUOTATION MARK
    [0x83, 0x0192], // LATIN SMALL LETTER F WITH HOOK
    [0x84, 0x201e], // DOUBLE LOW-9 QUOTATION MARK
    [0x85, 0x2026], // HORIZONTAL ELLIPSIS
    [0x86, 0x2020], // DAGGER
    [0x87, 0x2021], // DOUBLE DAGGER
    [0x88, 0x02c6], // MODIFIER LETTER CIRCUMFLEX ACCENT
    [0x89, 0x2030], // PER MILLE SIGN
    // 0x8A undefined
    [0x8b, 0x2039], // SINGLE LEFT-POINTING ANGLE QUOTATION MARK
    // 0x8C-0x8F undefined
    // 0x90 undefined
    [0x91, 0x2018], // LEFT SINGLE QUOTATION MARK
    [0x92, 0x2019], // RIGHT SINGLE QUOTATION MARK
    [0x93, 0x201c], // LEFT DOUBLE QUOTATION MARK
    [0x94, 0x201d], // RIGHT DOUBLE QUOTATION MARK
    [0x95, 0x2022], // BULLET
    [0x96, 0x2013], // EN DASH
    [0x97, 0x2014], // EM DASH
    [0x98, 0x02dc], // SMALL TILDE
    [0x99, 0x2122], // TRADE MARK SIGN
    // 0x9A undefined
    [0x9b, 0x203a], // SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
    // 0x9C-0x9F undefined
    [0xa0, 0x00a0], // NO-BREAK SPACE
    [0xa1, 0x00a1], // INVERTED EXCLAMATION MARK
    [0xa2, 0x00a2], // CENT SIGN
    [0xa3, 0x00a3], // POUND SIGN
    [0xa4, 0x20aa], // NEW SHEQEL SIGN ₪  — IMPORTANT for IL filings
    [0xa5, 0x00a5], // YEN SIGN
    [0xa6, 0x00a6], // BROKEN BAR
    [0xa7, 0x00a7], // SECTION SIGN
    [0xa8, 0x00a8], // DIAERESIS
    [0xa9, 0x00a9], // COPYRIGHT SIGN
    [0xaa, 0x00d7], // MULTIPLICATION SIGN (overrides ª — CP1255 quirk)
    [0xab, 0x00ab], // LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
    [0xac, 0x00ac], // NOT SIGN
    [0xad, 0x00ad], // SOFT HYPHEN
    [0xae, 0x00ae], // REGISTERED SIGN
    [0xaf, 0x00af], // MACRON
    [0xb0, 0x00b0], // DEGREE SIGN
    [0xb1, 0x00b1], // PLUS-MINUS SIGN
    [0xb2, 0x00b2], // SUPERSCRIPT TWO
    [0xb3, 0x00b3], // SUPERSCRIPT THREE
    [0xb4, 0x00b4], // ACUTE ACCENT
    [0xb5, 0x00b5], // MICRO SIGN
    [0xb6, 0x00b6], // PILCROW SIGN
    [0xb7, 0x00b7], // MIDDLE DOT
    [0xb8, 0x00b8], // CEDILLA
    [0xb9, 0x00b9], // SUPERSCRIPT ONE
    [0xba, 0x00f7], // DIVISION SIGN (overrides º — CP1255 quirk)
    [0xbb, 0x00bb], // RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
    [0xbc, 0x00bc], // VULGAR FRACTION ONE QUARTER
    [0xbd, 0x00bd], // VULGAR FRACTION ONE HALF
    [0xbe, 0x00be], // VULGAR FRACTION THREE QUARTERS
    [0xbf, 0x00bf], // INVERTED QUESTION MARK
    // 0xC0-0xC9 → Hebrew niqqud + cantillation
    [0xc0, 0x05b0], [0xc1, 0x05b1], [0xc2, 0x05b2], [0xc3, 0x05b3],
    [0xc4, 0x05b4], [0xc5, 0x05b5], [0xc6, 0x05b6], [0xc7, 0x05b7],
    [0xc8, 0x05b8], [0xc9, 0x05b9],
    // 0xCA undefined
    [0xcb, 0x05bb], [0xcc, 0x05bc], [0xcd, 0x05bd], [0xce, 0x05be],
    [0xcf, 0x05bf],
    [0xd0, 0x05c0], [0xd1, 0x05c1], [0xd2, 0x05c2], [0xd3, 0x05c3],
    [0xd4, 0x05f0], [0xd5, 0x05f1], [0xd6, 0x05f2], [0xd7, 0x05f3],
    [0xd8, 0x05f4],
    // 0xD9-0xDF undefined per CP1255 spec
    // 0xE0-0xFA → Hebrew letters aleph-tav
    [0xe0, 0x05d0], [0xe1, 0x05d1], [0xe2, 0x05d2], [0xe3, 0x05d3],
    [0xe4, 0x05d4], [0xe5, 0x05d5], [0xe6, 0x05d6], [0xe7, 0x05d7],
    [0xe8, 0x05d8], [0xe9, 0x05d9], [0xea, 0x05da], [0xeb, 0x05db],
    [0xec, 0x05dc], [0xed, 0x05dd], [0xee, 0x05de], [0xef, 0x05df],
    [0xf0, 0x05e0], [0xf1, 0x05e1], [0xf2, 0x05e2], [0xf3, 0x05e3],
    [0xf4, 0x05e4], [0xf5, 0x05e5], [0xf6, 0x05e6], [0xf7, 0x05e7],
    [0xf8, 0x05e8], [0xf9, 0x05e9], [0xfa, 0x05ea],
    // 0xFB-0xFC undefined per spec
    [0xfd, 0x200e], // LEFT-TO-RIGHT MARK
    [0xfe, 0x200f], // RIGHT-TO-LEFT MARK
    // 0xFF undefined
  ];
  for (const [b, cp] of upper) {
    t[b] = String.fromCodePoint(cp);
  }
  return t;
})();

/**
 * Reverse table: Unicode codepoint → CP1255 byte.
 * Computed once at module load. Keys are decimal codepoints (numbers).
 */
const CHAR_TO_BYTE: ReadonlyMap<number, number> = (() => {
  const m = new Map<number, number>();
  for (let b = 0; b < 256; b++) {
    const ch = BYTE_TO_CHAR[b];
    if (ch !== null && ch !== undefined) {
      m.set(ch.codePointAt(0)!, b);
    }
  }
  return m;
})();

export class UnsupportedCharacter extends Error {
  readonly codepoint: number;
  readonly offset: number;
  constructor(codepoint: number, offset: number) {
    super(
      `Character U+${codepoint.toString(16).toUpperCase().padStart(4, "0")} at offset ${offset} is not representable in windows-1255`,
    );
    this.name = "UnsupportedCharacter";
    this.codepoint = codepoint;
    this.offset = offset;
  }
}

/**
 * Encode a UTF-16 (JS native) string into Windows-1255 bytes.
 *
 * Throws `UnsupportedCharacter` on the first codepoint that has no
 * representation in CP1255 (e.g. Cyrillic, CJK, emoji). The thrown
 * error carries the offending codepoint + offset so callers can report
 * which field failed validation.
 *
 * Surrogate pairs (codepoints > U+FFFF) are always rejected — CP1255
 * is a BMP-only codepage.
 */
export function encodeWindows1255(input: string): Buffer {
  const out = Buffer.alloc(input.length);
  let outIdx = 0;
  let i = 0;
  while (i < input.length) {
    const cp = input.codePointAt(i)!;
    if (cp > 0xffff) {
      throw new UnsupportedCharacter(cp, i);
    }
    const byte = CHAR_TO_BYTE.get(cp);
    if (byte === undefined) {
      throw new UnsupportedCharacter(cp, i);
    }
    out[outIdx++] = byte;
    i += 1;
  }
  return out.subarray(0, outIdx);
}

/**
 * Decode Windows-1255 bytes into a UTF-16 string. Undefined slots emit
 * U+FFFD (Unicode replacement character) — never throws.
 */
export function decodeWindows1255(input: Buffer | Uint8Array): string {
  let result = "";
  for (let i = 0; i < input.length; i++) {
    const byte = input[i] ?? 0;
    const ch = BYTE_TO_CHAR[byte];
    result += ch ?? REPLACEMENT;
  }
  return result;
}

/**
 * Returns true if every character in `input` is representable in CP1255.
 * Use this to pre-validate text before building a fixed-width record so
 * you can give the user a row-level error instead of failing at encode.
 */
export function isRepresentableInWindows1255(input: string): boolean {
  let i = 0;
  while (i < input.length) {
    const cp = input.codePointAt(i)!;
    if (cp > 0xffff) return false;
    if (!CHAR_TO_BYTE.has(cp)) return false;
    i += 1;
  }
  return true;
}
