import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isRealNeonDb } from "./_helpers";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { user as authUser } from "@/db/schema/auth";
import { users } from "@/db/schema/identity";
import { getKek, __resetKekCacheForTests } from "@/lib/security/kek";
import {
  encryptStringWithKey,
  decryptStringWithKey,
} from "@/lib/security/encryption";

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

const TAG_PREFIX = `enc-${randomUUID().slice(0, 8)}-`;
const PLAINTEXT_DOB = "1990-01-15";
const state: { authId?: string; appId?: string } = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/encryption-aad] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

describeOrSkip("encryption AAD binding via DB round-trip", () => {
  beforeAll(async () => {
    // Refresh the KEK cache in case unit tests stubbed the env earlier.
    __resetKekCacheForTests();

    const authId = `${TAG_PREFIX}${randomUUID()}`;
    state.authId = authId;

    const appId = await withServiceRole(async (tx) => {
      await tx.insert(authUser).values({
        id: authId,
        name: `${TAG_PREFIX}name`,
        email: `${TAG_PREFIX}user@example.test`,
        emailVerified: true,
      });
      const inserted = await tx
        .insert(users)
        .values({ authUserId: authId })
        .returning({ id: users.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("seed: appId missing from returning()");
      return id;
    });
    state.appId = appId;

    // Encrypt dob_ciphertext with AAD bound to (users, dob_ciphertext, rowId).
    const key = getKek();
    const ciphertext = encryptStringWithKey({
      key,
      plaintext: PLAINTEXT_DOB,
      aad: { table: "users", column: "dob_ciphertext", rowId: appId },
    });

    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`UPDATE users SET dob_ciphertext = ${ciphertext} WHERE id = ${state.appId!}`,
      );
    });
  });

  afterAll(async () => {
    if (!state.authId) return;
    await withServiceRole(async (tx) => {
      if (state.appId) {
        await tx.execute(sql`DELETE FROM users WHERE id = ${state.appId!}`);
      }
      await tx.execute(sql`DELETE FROM "user" WHERE id = ${state.authId!}`);
    });
  });

  it("decrypts with the same AAD", async () => {
    const row = await withServiceRole(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT dob_ciphertext FROM users WHERE id = ${state.appId!}`,
      )) as unknown as Array<{ dob_ciphertext: string }>;
      return rows[0];
    });
    expect(row?.dob_ciphertext).toBeTypeOf("string");
    const decoded = decryptStringWithKey({
      key: getKek(),
      ciphertext: row!.dob_ciphertext,
      aad: {
        table: "users",
        column: "dob_ciphertext",
        rowId: state.appId!,
      },
    });
    expect(decoded).toBe(PLAINTEXT_DOB);
  });

  it("throws when decrypting with a cross-column AAD", async () => {
    const row = await withServiceRole(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT dob_ciphertext FROM users WHERE id = ${state.appId!}`,
      )) as unknown as Array<{ dob_ciphertext: string }>;
      return rows[0];
    });
    expect(() =>
      decryptStringWithKey({
        key: getKek(),
        ciphertext: row!.dob_ciphertext,
        aad: {
          table: "users",
          column: "national_id_ciphertext",
          rowId: state.appId!,
        },
      }),
    ).toThrow();
  });

  it("throws when decrypting with a different rowId", async () => {
    const row = await withServiceRole(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT dob_ciphertext FROM users WHERE id = ${state.appId!}`,
      )) as unknown as Array<{ dob_ciphertext: string }>;
      return rows[0];
    });
    expect(() =>
      decryptStringWithKey({
        key: getKek(),
        ciphertext: row!.dob_ciphertext,
        aad: {
          table: "users",
          column: "dob_ciphertext",
          rowId: randomUUID(),
        },
      }),
    ).toThrow();
  });
});
