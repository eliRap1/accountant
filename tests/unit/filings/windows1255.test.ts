import { describe, it, expect } from "vitest";
import {
  encodeWindows1255,
  decodeWindows1255,
  isRepresentableInWindows1255,
  UnsupportedCharacter,
} from "@/lib/filings/windows1255";

describe("windows-1255 ASCII passthrough", () => {
  it("encodes ASCII identically", () => {
    const buf = encodeWindows1255("Hello, World! 0123");
    const expected = Buffer.from("Hello, World! 0123", "ascii");
    expect(buf.equals(expected)).toBe(true);
  });

  it("decodes ASCII identically", () => {
    const text = decodeWindows1255(Buffer.from("Hello, World!", "ascii"));
    expect(text).toBe("Hello, World!");
  });

  it("round-trips a printable-ASCII range", () => {
    const range = Array.from({ length: 0x80 - 0x20 }, (_, i) =>
      String.fromCharCode(0x20 + i),
    ).join("");
    const buf = encodeWindows1255(range);
    expect(decodeWindows1255(buf)).toBe(range);
  });
});

describe("windows-1255 Hebrew letters (0xE0-0xFA)", () => {
  it("encodes aleph (א) to 0xE0", () => {
    const buf = encodeWindows1255("א");
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0xe0);
  });

  it("encodes tav (ת) to 0xFA", () => {
    const buf = encodeWindows1255("ת");
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0xfa);
  });

  it("round-trips the full Hebrew alphabet", () => {
    const alefBet = "אבגדהוזחטיכלמנסעפצקרשת";
    const buf = encodeWindows1255(alefBet);
    expect(buf.length).toBe(alefBet.length);
    expect(decodeWindows1255(buf)).toBe(alefBet);
  });

  it("round-trips a mixed Hebrew + Latin name", () => {
    const text = 'חברת "שלום" בע"מ — ABC123';
    const buf = encodeWindows1255(text);
    expect(decodeWindows1255(buf)).toBe(text);
  });

  it("encodes the new shekel sign (₪) to 0xA4", () => {
    const buf = encodeWindows1255("₪");
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0xa4);
  });
});

describe("windows-1255 rejection", () => {
  it("throws on Cyrillic", () => {
    expect(() => encodeWindows1255("Привет")).toThrow(UnsupportedCharacter);
  });

  it("throws on emoji (surrogate pair)", () => {
    expect(() => encodeWindows1255("🌍")).toThrow(UnsupportedCharacter);
  });

  it("throws on CJK", () => {
    expect(() => encodeWindows1255("中文")).toThrow(UnsupportedCharacter);
  });

  it("throws on Greek", () => {
    expect(() => encodeWindows1255("Α")).toThrow(UnsupportedCharacter);
  });

  it("error carries codepoint + offset", () => {
    try {
      encodeWindows1255("OK•Привет");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedCharacter);
      const err = e as UnsupportedCharacter;
      // "П" = U+041F at offset 3 ("OK•" then П).
      expect(err.codepoint).toBe(0x041f);
      expect(err.offset).toBe(3);
    }
  });
});

describe("windows-1255 isRepresentableInWindows1255", () => {
  it("returns true for ASCII", () => {
    expect(isRepresentableInWindows1255("Hello")).toBe(true);
  });

  it("returns true for Hebrew", () => {
    expect(isRepresentableInWindows1255("שלום")).toBe(true);
  });

  it("returns true for mixed CP1255 punctuation", () => {
    expect(isRepresentableInWindows1255("בע\"מ — ₪ • 123")).toBe(true);
  });

  it("returns false on Cyrillic", () => {
    expect(isRepresentableInWindows1255("Привет")).toBe(false);
  });

  it("returns false on emoji", () => {
    expect(isRepresentableInWindows1255("🚀")).toBe(false);
  });

  it("returns true for empty string", () => {
    expect(isRepresentableInWindows1255("")).toBe(true);
  });
});

describe("windows-1255 decode undefined slots", () => {
  it("decodes undefined slot 0x81 to U+FFFD", () => {
    const text = decodeWindows1255(Buffer.from([0x81]));
    expect(text).toBe("�");
  });

  it("decodes undefined slot 0xFF to U+FFFD", () => {
    const text = decodeWindows1255(Buffer.from([0xff]));
    expect(text).toBe("�");
  });
});

describe("windows-1255 specific upper-half codepoints", () => {
  it("maps en dash (U+2013) to 0x96", () => {
    expect(encodeWindows1255("–")[0]).toBe(0x96);
  });

  it("maps left-double-quote (U+201C) to 0x93", () => {
    expect(encodeWindows1255("“")[0]).toBe(0x93);
  });

  it("maps bullet (U+2022) to 0x95", () => {
    expect(encodeWindows1255("•")[0]).toBe(0x95);
  });

  it("maps LRM (U+200E) to 0xFD", () => {
    expect(encodeWindows1255("‎")[0]).toBe(0xfd);
  });

  it("maps RLM (U+200F) to 0xFE", () => {
    expect(encodeWindows1255("‏")[0]).toBe(0xfe);
  });
});
