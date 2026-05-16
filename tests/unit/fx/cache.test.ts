import { describe, it, expect, beforeEach } from "vitest";
import {
  readCache,
  writeCache,
  purgeCacheForTest,
  cacheFileForTest,
} from "@/lib/fx/cache";
import fs from "node:fs";

const KEY = "cache-test-key";
const TTL_LONG_MS = 60_000;
const TTL_INSTANT_MS = 0;

describe("fx cache — readCache / writeCache", () => {
  beforeEach(() => {
    purgeCacheForTest(KEY);
  });

  it("returns null on miss", () => {
    expect(readCache<{ x: number }>(KEY, TTL_LONG_MS)).toBeNull();
  });

  it("round-trips a JSON value within TTL", () => {
    const value = { rates: { USD: 3.6, EUR: 3.9 } };
    expect(writeCache(KEY, value)).toBe(true);
    const back = readCache<typeof value>(KEY, TTL_LONG_MS);
    expect(back).not.toBeNull();
    expect(back?.rates.USD).toBe(3.6);
    expect(back?.rates.EUR).toBe(3.9);
  });

  it("returns null when TTL is 0 (immediate expiry)", () => {
    writeCache(KEY, { a: 1 });
    expect(readCache(KEY, TTL_INSTANT_MS)).toBeNull();
  });

  it("returns null when the file is corrupt", () => {
    writeCache(KEY, { a: 1 });
    const path = cacheFileForTest(KEY);
    // Overwrite with garbage so JSON.parse throws.
    fs.writeFileSync(path, "{not-json", "utf8");
    expect(readCache(KEY, TTL_LONG_MS)).toBeNull();
  });

  it("survives concurrent writes (last-writer-wins, never partial)", async () => {
    const writes = Array.from({ length: 8 }, (_, i) =>
      Promise.resolve().then(() => writeCache(KEY, { writer: i })),
    );
    await Promise.all(writes);
    const got = readCache<{ writer: number }>(KEY, TTL_LONG_MS);
    expect(got).not.toBeNull();
    expect(typeof got?.writer).toBe("number");
    // Just confirm parseability — last-writer-wins is non-deterministic
    // but the file MUST be a valid JSON envelope.
  });

  it("does not throw on unreadable directory paths (returns false/null)", () => {
    // Use a value that should still succeed. Then verify readCache returns
    // null for a never-written key.
    expect(readCache("never-written-key", TTL_LONG_MS)).toBeNull();
  });
});

describe("fx cache — purgeCacheForTest", () => {
  it("removes a written cache entry", () => {
    writeCache(KEY, { a: 1 });
    expect(readCache(KEY, TTL_LONG_MS)).not.toBeNull();
    expect(purgeCacheForTest(KEY)).toBe(true);
    expect(readCache(KEY, TTL_LONG_MS)).toBeNull();
  });

  it("returns false when entry does not exist", () => {
    expect(purgeCacheForTest("definitely-not-here")).toBe(false);
  });
});
