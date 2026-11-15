import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { getKek } from "@/lib/security/kek";
import { aesGcmEncrypt, aesGcmDecrypt } from "@/lib/security/encryption";

// Envelope encryption (Plan v4 Risk #6 / council C-1).
//
// Hierarchy:
//   KEK   = env.DATA_ENCRYPTION_KEY (32 random bytes, base64 in env)
//   DEK   = 32 random bytes generated per `purpose`, wrapped under KEK
//           with AES-256-GCM and persisted in data_encryption_keys row
//   COL   = ciphertext columns (clients.email_ciphertext, ...) encrypted
//           with the *unwrapped* DEK; AAD remains {table, column, rowId}
//
// Right-of-erasure: retire the DEK row — wrapped_dek/iv/auth_tag are
// zeroed (set NULL); the table-level ciphertext bytes remain in place
// (7-year retention per IL Income Tax Ordinance § 130) but are now
// mathematically unrecoverable. The encrypted column data is dead weight
// after the DEK is retired.
//
// AAD for the WRAPPED DEK row uses the canonical
// {table:'data_encryption_keys', column:'wrapped_dek', rowId:<dek_id>}
// shape — same AAD machinery as column encryption, just bound to a
// different row in a different table.

const WRAP_TABLE = "data_encryption_keys" as const;
const WRAP_COLUMN = "wrapped_dek" as const;

// LRU-ish cache of unwrapped DEKs (10-min TTL). Avoids re-unwrapping the
// same DEK on every column read in a request burst. Keyed by dekId.
// Entries hold a *copy* of the plaintext key; we zero the Buffer when
// the entry expires.
type CacheEntry = {
  plaintext: Buffer;
  expiresAt: number;
};
const CACHE_TTL_MS = 10 * 60 * 1000;
const unwrapCache = new Map<string, CacheEntry>();

function cacheGet(dekId: string): Buffer | null {
  const entry = unwrapCache.get(dekId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    // TTL expired — zero the plaintext bytes before evicting so the key
    // material does not linger in memory after its window closes.
    entry.plaintext.fill(0);
    unwrapCache.delete(dekId);
    return null;
  }
  return entry.plaintext;
}

function cacheSet(dekId: string, plaintext: Buffer): void {
  // Store a fresh copy so the caller can zero their own copy after use
  // without invalidating the cache entry.
  const copy = Buffer.from(plaintext);
  unwrapCache.set(dekId, { plaintext: copy, expiresAt: Date.now() + CACHE_TTL_MS });
}

function cacheEvict(dekId: string): void {
  const entry = unwrapCache.get(dekId);
  if (entry) {
    entry.plaintext.fill(0);
    unwrapCache.delete(dekId);
  }
}

// Test-only escape hatch: clear the in-memory cache between vitest cases.
export function __resetDekCacheForTests(): void {
  for (const [, entry] of unwrapCache) entry.plaintext.fill(0);
  unwrapCache.clear();
}

type DekRow = {
  id: string;
  wrapped_dek: Buffer | null;
  wrapped_dek_iv: Buffer | null;
  wrapped_dek_auth_tag: Buffer | null;
  kek_version: number;
  retired_at: Date | null;
};

/**
 * Generate a new DEK for `purpose`. Wraps under the master KEK and inserts
 * the wrapped row into `data_encryption_keys`. Returns the row id plus the
 * plaintext DEK so the caller can immediately encrypt with it.
 *
 * IMPORTANT: the caller MUST zero the returned plaintext Buffer after use
 * (`plaintext.fill(0)`). The key material is the highest-blast-radius
 * thing in this codebase — leaks pwn every row that DEK ever encrypted.
 *
 * Uniqueness: the partial unique index on (purpose) WHERE retired_at IS
 * NULL means two concurrent inserts targeting the same purpose collide
 * at the DB layer. The caller is responsible for the get-or-create
 * pattern via getActiveDek() — this function is the create half only.
 */
export async function generateDek(
  purpose: string,
): Promise<{ dekId: string; plaintext: Buffer }> {
  const plaintext = crypto.randomBytes(32);
  const kek = getKek();

  // We do not know the dekId until INSERT returns. Strategy: pre-generate
  // a UUID app-side so we can compute the AAD before the INSERT.
  const dekId = crypto.randomUUID();
  const { iv, authTag, ciphertext } = aesGcmEncrypt({
    key: kek,
    plaintext: plaintext.toString("base64"),
    aad: { table: WRAP_TABLE, column: WRAP_COLUMN, rowId: dekId },
  });

  await withServiceRole(async (tx) => {
    await tx.execute(
      sql`INSERT INTO data_encryption_keys (
            id, purpose, wrapped_dek, wrapped_dek_iv, wrapped_dek_auth_tag, kek_version
          ) VALUES (
            ${dekId}::uuid,
            ${purpose},
            ${ciphertext},
            ${iv},
            ${authTag},
            ${1}
          )`,
    );
  });

  return { dekId, plaintext };
}

/**
 * Look up the active DEK for `purpose`, or null if none exists. Returns
 * the row id plus the unwrapped plaintext (cached for CACHE_TTL_MS).
 *
 * Caller must zero the returned plaintext when done (Buffer.fill(0)).
 */
export async function getActiveDek(
  purpose: string,
): Promise<{ dekId: string; plaintext: Buffer } | null> {
  const row = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id, wrapped_dek, wrapped_dek_iv, wrapped_dek_auth_tag, kek_version, retired_at
            FROM data_encryption_keys
           WHERE purpose = ${purpose}
             AND retired_at IS NULL
           LIMIT 1`,
    )) as unknown as Array<DekRow>;
    return rows[0] ?? null;
  });

  if (!row) return null;

  const cached = cacheGet(row.id);
  if (cached) {
    return { dekId: row.id, plaintext: Buffer.from(cached) };
  }

  const plaintext = await unwrapRow(row);
  cacheSet(row.id, plaintext);
  return { dekId: row.id, plaintext };
}

/**
 * Get the active DEK for `purpose`, generating one if absent. Concurrent
 * callers race on the partial unique index — losers retry the read.
 */
export async function getOrCreateActiveDek(
  purpose: string,
): Promise<{ dekId: string; plaintext: Buffer }> {
  const existing = await getActiveDek(purpose);
  if (existing) return existing;

  try {
    return await generateDek(purpose);
  } catch (err) {
    // Lost the race — another caller just inserted. Read back the winner.
    const winner = await getActiveDek(purpose);
    if (winner) return winner;
    throw err;
  }
}

/**
 * Unwrap a known dekId. Used by decrypt paths that already know which
 * DEK a ciphertext column was encrypted under (via a *_key_id FK).
 *
 * Caller must zero the returned plaintext after use.
 */
export async function unwrapDek(dekId: string): Promise<Buffer> {
  const cached = cacheGet(dekId);
  if (cached) return Buffer.from(cached);

  const row = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id, wrapped_dek, wrapped_dek_iv, wrapped_dek_auth_tag, kek_version, retired_at
            FROM data_encryption_keys
           WHERE id = ${dekId}::uuid
           LIMIT 1`,
    )) as unknown as Array<DekRow>;
    return rows[0] ?? null;
  });

  if (!row) throw new Error(`unwrapDek: dek ${dekId} not found`);
  if (row.wrapped_dek === null || row.wrapped_dek_iv === null || row.wrapped_dek_auth_tag === null) {
    throw new Error(`unwrapDek: dek ${dekId} is retired (key material destroyed)`);
  }

  const plaintext = await unwrapRow(row);
  cacheSet(dekId, plaintext);
  return plaintext;
}

async function unwrapRow(row: DekRow): Promise<Buffer> {
  if (row.wrapped_dek === null || row.wrapped_dek_iv === null || row.wrapped_dek_auth_tag === null) {
    throw new Error(`unwrapDek: dek ${row.id} is retired (key material destroyed)`);
  }
  const kek = getKek();
  const plaintextB64 = aesGcmDecrypt({
    key: kek,
    iv: Buffer.from(row.wrapped_dek_iv),
    authTag: Buffer.from(row.wrapped_dek_auth_tag),
    ciphertext: Buffer.from(row.wrapped_dek),
    aad: { table: WRAP_TABLE, column: WRAP_COLUMN, rowId: row.id },
  });
  return Buffer.from(plaintextB64, "base64");
}

/**
 * Retire a DEK: stamp retired_at and zero the wrapped key material. The
 * ciphertext columns that reference this DEK become mathematically
 * unrecoverable (this is the deliberate crypto-erasure mechanism that
 * powers IL Privacy Law Amendment 13 right-of-erasure while preserving
 * the 7-year retained ciphertext for ITA audit).
 *
 * Idempotent: re-retiring an already-retired DEK is a no-op.
 */
export async function retireDek(
  dekId: string,
  notes: string,
): Promise<void> {
  cacheEvict(dekId);
  await withServiceRole(async (tx) => {
    await tx.execute(
      sql`UPDATE data_encryption_keys
            SET retired_at = COALESCE(retired_at, now()),
                wrapped_dek = NULL,
                wrapped_dek_iv = NULL,
                wrapped_dek_auth_tag = NULL,
                destruction_notes = ${notes}
          WHERE id = ${dekId}::uuid`,
    );
  });
}
