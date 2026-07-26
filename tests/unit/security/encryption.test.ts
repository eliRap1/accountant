import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  aesGcmEncrypt,
  aesGcmDecrypt,
  encodeAesGcmString,
  decodeAesGcmString,
  encryptStringWithKey,
  decryptStringWithKey,
  type AesGcmAad,
} from "@/lib/security/encryption";

// Deterministic 32-byte key for round-trip tests. Never used in prod.
const KEY = crypto.createHash("sha256").update("encryption-test-key").digest();
const AAD: AesGcmAad = { table: "users", column: "dob_ciphertext", rowId: "row-1" };

describe("aesGcm round-trip", () => {
  it("restores ASCII plaintext", () => {
    const ct = encryptStringWithKey({ key: KEY, plaintext: "hello world", aad: AAD });
    expect(decryptStringWithKey({ key: KEY, ciphertext: ct, aad: AAD })).toBe(
      "hello world",
    );
  });

  it("restores empty string", () => {
    const ct = encryptStringWithKey({ key: KEY, plaintext: "", aad: AAD });
    expect(decryptStringWithKey({ key: KEY, ciphertext: ct, aad: AAD })).toBe("");
  });

  it("restores Hebrew (RTL multi-byte) plaintext", () => {
    const plain = "שלום עולם — ח.פ. 514321987";
    const ct = encryptStringWithKey({ key: KEY, plaintext: plain, aad: AAD });
    expect(decryptStringWithKey({ key: KEY, ciphertext: ct, aad: AAD })).toBe(plain);
  });

  it("restores mixed Hebrew / English / Russian / emoji plaintext", () => {
    const plain = "שלום • Привет • Hello • 12345 • 🌍";
    const ct = encryptStringWithKey({ key: KEY, plaintext: plain, aad: AAD });
    expect(decryptStringWithKey({ key: KEY, ciphertext: ct, aad: AAD })).toBe(plain);
  });

  it("restores a 4 KiB random-ASCII payload", () => {
    const plain = crypto.randomBytes(4096).toString("base64");
    const ct = encryptStringWithKey({ key: KEY, plaintext: plain, aad: AAD });
    expect(decryptStringWithKey({ key: KEY, ciphertext: ct, aad: AAD })).toBe(plain);
  });
});

describe("aesGcm tamper / AAD safety", () => {
  it("throws when table AAD changes", () => {
    const ct = encryptStringWithKey({ key: KEY, plaintext: "secret", aad: AAD });
    expect(() =>
      decryptStringWithKey({
        key: KEY,
        ciphertext: ct,
        aad: { ...AAD, table: "businesses" },
      }),
    ).toThrow();
  });

  it("throws when column AAD changes", () => {
    const ct = encryptStringWithKey({ key: KEY, plaintext: "secret", aad: AAD });
    expect(() =>
      decryptStringWithKey({
        key: KEY,
        ciphertext: ct,
        aad: { ...AAD, column: "national_id_ciphertext" },
      }),
    ).toThrow();
  });

  it("throws when rowId AAD changes", () => {
    const ct = encryptStringWithKey({ key: KEY, plaintext: "secret", aad: AAD });
    expect(() =>
      decryptStringWithKey({
        key: KEY,
        ciphertext: ct,
        aad: { ...AAD, rowId: "row-2" },
      }),
    ).toThrow();
  });

  it("throws when ciphertext bytes are flipped", () => {
    const enc = aesGcmEncrypt({ key: KEY, plaintext: "tamper-me", aad: AAD });
    const tampered = Buffer.from(enc.ciphertext);
    // Flip a bit in the body so the auth tag fails.
    if (tampered.length === 0) throw new Error("ciphertext should not be empty");
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    expect(() =>
      aesGcmDecrypt({
        key: KEY,
        iv: enc.iv,
        authTag: enc.authTag,
        ciphertext: tampered,
        aad: AAD,
      }),
    ).toThrow();
  });
});

describe("aesGcm wrong key", () => {
  it("throws when decrypted with a different 32-byte key", () => {
    const ct = encryptStringWithKey({ key: KEY, plaintext: "x", aad: AAD });
    const otherKey = crypto.createHash("sha256").update("other-key").digest();
    expect(() =>
      decryptStringWithKey({ key: otherKey, ciphertext: ct, aad: AAD }),
    ).toThrow();
  });
});

describe("aesGcm key-length assertion", () => {
  it("throws at encrypt when key is 31 bytes", () => {
    const shortKey = Buffer.alloc(31);
    expect(() =>
      aesGcmEncrypt({ key: shortKey, plaintext: "x", aad: AAD }),
    ).toThrow(/32 bytes/);
  });

  it("throws at encrypt when key is 33 bytes", () => {
    const longKey = Buffer.alloc(33);
    expect(() =>
      aesGcmEncrypt({ key: longKey, plaintext: "x", aad: AAD }),
    ).toThrow(/32 bytes/);
  });

  it("throws at decrypt when key is the wrong length", () => {
    const shortKey = Buffer.alloc(31);
    expect(() =>
      aesGcmDecrypt({
        key: shortKey,
        iv: Buffer.alloc(12),
        authTag: Buffer.alloc(16),
        ciphertext: Buffer.alloc(0),
        aad: AAD,
      }),
    ).toThrow(/32 bytes/);
  });
});

describe("wire format encode/decode", () => {
  it("round-trips encodeAesGcmString + decodeAesGcmString", () => {
    const enc = aesGcmEncrypt({ key: KEY, plaintext: "round-trip", aad: AAD });
    const wire = encodeAesGcmString(enc);
    expect(wire.startsWith("v1:")).toBe(true);
    const decoded = decodeAesGcmString(wire);
    expect(decoded.iv.equals(enc.iv)).toBe(true);
    expect(decoded.authTag.equals(enc.authTag)).toBe(true);
    expect(decoded.ciphertext.equals(enc.ciphertext)).toBe(true);
  });

  it("throws on an unsupported v2 prefix", () => {
    expect(() => decodeAesGcmString("v2:aa:bb:cc")).toThrow(/wire format/);
  });

  it("throws when fewer than 4 colon-separated parts are present", () => {
    expect(() => decodeAesGcmString("v1:aa:bb")).toThrow(/wire format/);
  });
});
