// Tiny JSON-file cache for outbound third-party calls (FX rates, ITA
// registry lookups). Designed for read-heavy / append-rare workloads
// against external endpoints that publish daily-or-slower data.
//
// Phase F will move these to Postgres tables; this file is a stop-gap
// so Phase C can ship without a migration.
//
// Concurrency: we use atomic rename (write to .tmp then rename) so a
// reader either sees the old value or the new value, never a partial
// payload. Multiple writers may clobber each other, but the value space
// is idempotent (last write wins, same content from same source).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Repository root resolved via the file URL so the cache lives next to
// package.json rather than next to the compiled module (which could be
// inside .next/server/...). We import.meta.url-resolve once.
const moduleDir = path.dirname(new URL(import.meta.url).pathname);
// lib/fx/cache.ts -> repo root is two levels up.
const REPO_ROOT = path.resolve(
  moduleDir.replace(/^\/([A-Za-z]):/, "$1:"), // strip the leading slash Windows leaves
  "..",
  "..",
);
const CACHE_DIR = path.join(REPO_ROOT, ".cache");

type CacheEnvelope<T> = {
  storedAt: number; // epoch ms
  value: T;
};

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function safeKey(key: string): string {
  // Replace anything non-alphanumeric with `_` and append a short hash to
  // disambiguate "USD-2026-05-15" and "USD_2026_05_15".
  const sanitised = key.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
  return `${sanitised}__${hash}.json`;
}

function cachePathForKey(key: string): string {
  return path.join(CACHE_DIR, safeKey(key));
}

/**
 * Read a cached value if it is fresher than `ttlMs`. Returns `null` on
 * miss / stale / unparseable / IO error — never throws.
 *
 * `ttlMs` of 0 means "always stale" — useful for testing.
 */
export function readCache<T>(key: string, ttlMs: number): T | null {
  try {
    const file = cachePathForKey(key);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    const age = Date.now() - parsed.storedAt;
    // `>=` so a TTL of 0 always misses, matching the test expectation
    // ("instant expiry"). A live cache entry never has age < 0.
    if (age >= ttlMs) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

/**
 * Write a cached value. Uses temp-then-rename so partial writes are
 * never observed by readers.
 *
 * Returns `true` on success, `false` if the filesystem rejected the
 * write — never throws so caller paths can degrade gracefully.
 */
export function writeCache<T>(key: string, value: T): boolean {
  try {
    ensureCacheDir();
    const file = cachePathForKey(key);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const envelope: CacheEnvelope<T> = { storedAt: Date.now(), value };
    fs.writeFileSync(tmp, JSON.stringify(envelope), "utf8");
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the cache file for a given key — exposed for test cleanup. */
export function cacheFileForTest(key: string): string {
  return cachePathForKey(key);
}

/** Test helper — wipe a single cache entry. Returns true if removed. */
export function purgeCacheForTest(key: string): boolean {
  try {
    const file = cachePathForKey(key);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
  } catch {
    /* swallow */
  }
  return false;
}
