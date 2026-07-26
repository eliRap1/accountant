import { env } from "@/lib/env";

let cached: Buffer | null = null;

// Resolve the master key-encryption key from env.DATA_ENCRYPTION_KEY.
// Used directly today for column encryption; once envelope encryption
// lands (Layer 3 / Phase F) the KEK only wraps per-purpose DEKs stored in
// data_encryption_keys.
export function getKek(): Buffer {
  if (cached) return cached;
  const raw = Buffer.from(env().DATA_ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) {
    throw new Error(
      `DATA_ENCRYPTION_KEY must base64-decode to exactly 32 bytes (got ${raw.length})`,
    );
  }
  cached = raw;
  return cached;
}

// Test-only escape hatch so vitest can reset the singleton between cases.
// Production code paths must never call this.
export function __resetKekCacheForTests(): void {
  cached = null;
}
