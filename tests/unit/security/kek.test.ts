import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `lib/env.ts` caches its parsed env at module scope, so mutating
// process.env mid-test does not change what env() returns. We mock the
// whole module so each test can dictate exactly what
// `env().DATA_ENCRYPTION_KEY` resolves to before getKek reads it.

let mockKey = Buffer.alloc(32, 9).toString("base64");

vi.mock("@/lib/env", () => ({
  env: () => ({ DATA_ENCRYPTION_KEY: mockKey }),
}));

// Imported AFTER vi.mock so the mocked env is in place at first call.
const { __resetKekCacheForTests, getKek } = await import("@/lib/security/kek");

function setKey(b64: string) {
  mockKey = b64;
  __resetKekCacheForTests();
}

beforeEach(() => {
  __resetKekCacheForTests();
});

afterEach(() => {
  __resetKekCacheForTests();
});

describe("getKek", () => {
  it("returns a 32-byte Buffer for a valid 32-byte base64 input", () => {
    setKey(Buffer.alloc(32, 7).toString("base64"));
    const buf = getKek();
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
    expect(buf.every((b) => b === 7)).toBe(true);
  });

  it("caches the result across calls (same Buffer reference)", () => {
    setKey(Buffer.alloc(32, 1).toString("base64"));
    const a = getKek();
    const b = getKek();
    expect(a).toBe(b);
  });

  it("__resetKekCacheForTests clears the singleton", () => {
    setKey(Buffer.alloc(32, 1).toString("base64"));
    const a = getKek();
    __resetKekCacheForTests();
    // Same input, but the singleton was cleared — the new Buffer is a
    // fresh allocation, not the cached one.
    const b = getKek();
    expect(a).not.toBe(b);
    expect(a.equals(b)).toBe(true);
  });

  it("throws when DATA_ENCRYPTION_KEY decodes to fewer than 32 bytes", () => {
    setKey(Buffer.alloc(16).toString("base64"));
    expect(() => getKek()).toThrow(/32 bytes/);
  });

  it("throws when DATA_ENCRYPTION_KEY decodes to more than 32 bytes", () => {
    setKey(Buffer.alloc(48).toString("base64"));
    expect(() => getKek()).toThrow(/32 bytes/);
  });
});
