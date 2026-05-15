import crypto from "node:crypto";

// Every ciphertext column we ever write is bound to its position in the
// schema via an authenticated-additional-data tuple. Forging a ciphertext
// from a different (table, column, rowId) trips AES-GCM's auth-tag check
// at decrypt time, so a row swap or column copy is detectable as tampering.
export type AesGcmAad = {
  table: string;
  column: string;
  rowId: string;
};

function aadBuffer(aad: AesGcmAad): Buffer {
  return Buffer.from(
    JSON.stringify({ table: aad.table, column: aad.column, rowId: aad.rowId }),
    "utf8",
  );
}

export function aesGcmEncrypt(args: {
  key: Buffer;
  plaintext: string;
  aad: AesGcmAad;
}): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } {
  if (args.key.length !== 32) {
    throw new Error("aesGcmEncrypt: key must be 32 bytes");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", args.key, iv);
  cipher.setAAD(aadBuffer(args.aad));
  const ciphertext = Buffer.concat([
    cipher.update(args.plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { iv, authTag, ciphertext };
}

export function aesGcmDecrypt(args: {
  key: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
  aad: AesGcmAad;
}): string {
  if (args.key.length !== 32) {
    throw new Error("aesGcmDecrypt: key must be 32 bytes");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", args.key, args.iv);
  decipher.setAAD(aadBuffer(args.aad));
  decipher.setAuthTag(args.authTag);
  return Buffer.concat([
    decipher.update(args.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

// Wire format for text columns. v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>.
// Versioned to allow future swap to a longer auth tag or different cipher
// without changing column types.
export function encodeAesGcmString(parts: {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}): string {
  return [
    "v1",
    parts.iv.toString("base64"),
    parts.authTag.toString("base64"),
    parts.ciphertext.toString("base64"),
  ].join(":");
}

export function decodeAesGcmString(s: string): {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
} {
  const parts = s.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("decodeAesGcmString: unsupported wire format");
  }
  return {
    iv: Buffer.from(parts[1] ?? "", "base64"),
    authTag: Buffer.from(parts[2] ?? "", "base64"),
    ciphertext: Buffer.from(parts[3] ?? "", "base64"),
  };
}

// High-level helpers operating on the text-column wire format. Layer 1
// callers pass the KEK directly; envelope encryption (Layer 3) will swap
// the key argument for an unwrapped per-row DEK.
export function encryptStringWithKey(args: {
  key: Buffer;
  plaintext: string;
  aad: AesGcmAad;
}): string {
  return encodeAesGcmString(aesGcmEncrypt(args));
}

export function decryptStringWithKey(args: {
  key: Buffer;
  ciphertext: string;
  aad: AesGcmAad;
}): string {
  const parts = decodeAesGcmString(args.ciphertext);
  return aesGcmDecrypt({ key: args.key, ...parts, aad: args.aad });
}
