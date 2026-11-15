import crypto from "node:crypto";

// AES-256-GCM primitives + envelope-encryption helpers.
//
// Key hierarchy (Plan v4 Risk #6 / council C-1):
//   KEK   = env.DATA_ENCRYPTION_KEY (master key)
//          → wraps DEKs only (see lib/security/dek.ts)
//   DEK   = per-purpose data-encryption key, persisted wrapped under KEK
//          in `data_encryption_keys`. Unwrapping requires the KEK + the
//          DEK row's AAD ({table:'data_encryption_keys', column:
//          'wrapped_dek', rowId:<dek_id>}).
//   COL   = PII column ciphertext (clients.email_ciphertext, …) encrypted
//          with the *unwrapped* DEK, AAD = {table, column, rowId} bound
//          to the column's owning row.
//
// Right-of-erasure: retire the DEK row (lib/security/dek.ts retireDek).
// The encrypted column bytes remain on disk (7-year retention per IL
// Income Tax Ordinance § 130) but become mathematically unrecoverable.
//
// The two legacy helpers `encryptStringWithKey` / `decryptStringWithKey`
// are kept for the boot-time selfTest only — they exercise AES-GCM under
// the KEK directly. Application paths MUST use the DEK helpers below.
//
// AAD serialisation invariant: JSON of {table, column, rowId} in that
// EXACT key order. Re-ordering keys produces different bytes and breaks
// every existing ciphertext. Do not introduce a key-reorder regression.
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

// Boot-time helpers. KEK is passed in directly. Application paths MUST
// use the DEK-based helpers below — only the selfTest exercises these.
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

// Envelope-encryption helpers. The caller supplies a `purpose` string —
// e.g. `business:<businessId>:client_contact`. We resolve (or create)
// the active DEK for that purpose, encrypt the plaintext under the
// unwrapped DEK, and return both the ciphertext and the dekId so the
// caller can store the dekId in the row's *_key_id column.
//
// Zeroing: the DEK plaintext bytes are zeroed before this function
// returns — they live only for the encrypt window. The unwrapDek cache
// keeps its OWN copy with its own TTL (see lib/security/dek.ts).
export async function encryptStringWithDek(args: {
  purpose: string;
  plaintext: string;
  aad: AesGcmAad;
}): Promise<{ ciphertext: string; dekId: string }> {
  const { getOrCreateActiveDek } = await import("@/lib/security/dek");
  const { dekId, plaintext: dek } = await getOrCreateActiveDek(args.purpose);
  try {
    const ciphertext = encryptStringWithKey({
      key: dek,
      plaintext: args.plaintext,
      aad: args.aad,
    });
    return { ciphertext, dekId };
  } finally {
    dek.fill(0);
  }
}

export async function decryptStringWithDek(args: {
  dekId: string;
  ciphertext: string;
  aad: AesGcmAad;
}): Promise<string> {
  const { unwrapDek } = await import("@/lib/security/dek");
  const dek = await unwrapDek(args.dekId);
  try {
    return decryptStringWithKey({
      key: dek,
      ciphertext: args.ciphertext,
      aad: args.aad,
    });
  } finally {
    dek.fill(0);
  }
}
