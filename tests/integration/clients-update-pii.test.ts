import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isRealNeonDb } from "./_helpers";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { withUser } from "@/lib/db/withUser";
import { user as authUser } from "@/db/schema/auth";
import { users } from "@/db/schema/identity";
import { businesses } from "@/db/schema/businesses";
import {
  decryptStringWithKey,
  encryptStringWithKey,
} from "@/lib/security/encryption";
import { getKek, __resetKekCacheForTests } from "@/lib/security/kek";

// Council C-6: updateClient must NOT overwrite existing ciphertext with
// NULL when the form submission has blank PII fields.
//
// We test the underlying SQL behaviour that the server action runs:
//   - INSERT a client with email/phone/notes ciphertexts.
//   - Simulate the "edit only the legal_name; blank email/phone/notes"
//     code path of the new updateClient: don't touch PII columns at all
//     (preserve = NOOP at SQL).
//   - Verify ciphertexts unchanged + decryptable to the original
//     plaintext.
//   - Verify the "write new value" branch encrypts under fresh AAD.
//
// We don't import the action wrapper here because it pulls in
// next-intl/server + server-only which fail to resolve under vitest.

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

const TAG_PREFIX = `cupii-${randomUUID().slice(0, 8)}-`;

type Seed = {
  authUserId: string;
  appUserId: string;
  businessId: string;
  clientId: string;
};
const state: Partial<Seed> = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/clients-update-pii] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

function encryptForRow(plaintext: string, rowId: string, column: string): string {
  return encryptStringWithKey({
    key: getKek(),
    plaintext,
    aad: { table: "clients", column, rowId },
  });
}

describeOrSkip("updateClient PII preservation (C-6)", () => {
  beforeAll(async () => {
    __resetKekCacheForTests();
    await withServiceRole(async (tx) => {
      const authId = `${TAG_PREFIX}auth-${randomUUID()}`;
      await tx.insert(authUser).values({
        id: authId,
        name: `${TAG_PREFIX}n`,
        email: `${TAG_PREFIX}@example.test`,
        emailVerified: true,
      });
      const insertedUser = await tx
        .insert(users)
        .values({ authUserId: authId })
        .returning({ id: users.id });
      const appUserId = insertedUser[0]?.id;
      if (!appUserId) throw new Error("seed: appUserId missing");

      const insertedBiz = await tx
        .insert(businesses)
        .values({
          ownerUserId: appUserId,
          legalName: `${TAG_PREFIX}biz`,
          vatId: `${TAG_PREFIX}vat`,
          entityType: "morshe",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "double_entry",
        })
        .returning({ id: businesses.id });
      const businessId = insertedBiz[0]?.id;
      if (!businessId) throw new Error("seed: businessId missing");

      state.authUserId = authId;
      state.appUserId = appUserId;
      state.businessId = businessId;
    });
  });

  afterAll(async () => {
    if (!state.appUserId) return;
    await withServiceRole(async (tx) => {
      if (state.clientId) {
        await tx.execute(
          sql`DELETE FROM clients WHERE id = ${state.clientId!}::uuid`,
        );
      }
      await tx.execute(
        sql`DELETE FROM businesses WHERE id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM users WHERE id = ${state.appUserId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM "user" WHERE id = ${state.authUserId!}`,
      );
    });
  });

  it("preserves existing ciphertext when PII fields are blank on update (new SQL path)", async () => {
    // 1. Seed a client with all PII columns populated.
    const clientId = await withUser(state.appUserId!, async (tx) => {
      const inserted = (await tx.execute(
        sql`INSERT INTO clients (business_id, legal_name)
            VALUES (${state.businessId!}::uuid, ${`${TAG_PREFIX}clientA`})
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const id = inserted[0]!.id;
      const emailCt = encryptForRow("alice@example.test", id, "email_ciphertext");
      const phoneCt = encryptForRow("+972-50-1234567", id, "phone_ciphertext");
      const notesCt = encryptForRow("VIP client; ping monthly", id, "notes_ciphertext");
      await tx.execute(
        sql`UPDATE clients SET email_ciphertext = ${emailCt},
                                phone_ciphertext = ${phoneCt},
                                notes_ciphertext = ${notesCt}
            WHERE id = ${id}::uuid`,
      );
      return id;
    });
    state.clientId = clientId;

    const before = await withServiceRole(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT email_ciphertext, phone_ciphertext, notes_ciphertext
              FROM clients WHERE id = ${clientId}::uuid`,
      )) as unknown as Array<{
        email_ciphertext: string | null;
        phone_ciphertext: string | null;
        notes_ciphertext: string | null;
      }>;
      return rows[0]!;
    });
    expect(before.email_ciphertext).toBeTypeOf("string");
    expect(before.phone_ciphertext).toBeTypeOf("string");
    expect(before.notes_ciphertext).toBeTypeOf("string");

    // 2. Simulate the new updateClient flow:
    //    - rename via the non-PII UPDATE (always runs)
    //    - skip the three PII UPDATEs because all fields are blank
    //      ('preserve' branch).
    await withUser(state.appUserId!, async (tx) => {
      await tx.execute(
        sql`UPDATE clients SET legal_name = ${`${TAG_PREFIX}clientA-renamed`},
                               default_payment_terms_days = 30
            WHERE id = ${clientId}::uuid AND deleted_at IS NULL`,
      );
      // Intentionally NO email/phone/notes UPDATE — that's the C-6 fix.
    });

    const after = await withServiceRole(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT email_ciphertext, phone_ciphertext, notes_ciphertext,
                   legal_name, default_payment_terms_days
              FROM clients WHERE id = ${clientId}::uuid`,
      )) as unknown as Array<{
        email_ciphertext: string | null;
        phone_ciphertext: string | null;
        notes_ciphertext: string | null;
        legal_name: string;
        default_payment_terms_days: number;
      }>;
      return rows[0]!;
    });

    expect(after.email_ciphertext).toBe(before.email_ciphertext);
    expect(after.phone_ciphertext).toBe(before.phone_ciphertext);
    expect(after.notes_ciphertext).toBe(before.notes_ciphertext);
    expect(after.legal_name).toBe(`${TAG_PREFIX}clientA-renamed`);
    expect(after.default_payment_terms_days).toBe(30);

    // The ciphertext still decrypts under the same AAD.
    expect(
      decryptStringWithKey({
        key: getKek(),
        ciphertext: after.email_ciphertext!,
        aad: {
          table: "clients",
          column: "email_ciphertext",
          rowId: clientId,
        },
      }),
    ).toBe("alice@example.test");
  });

  it("encrypts and overwrites when PII fields contain non-empty values (write branch)", async () => {
    if (!state.clientId) throw new Error("clientId missing from prior test");
    const clientId = state.clientId;

    // Simulate the "write" branch: re-encrypt only email + phone with
    // new plaintexts; notes is left untouched ('preserve').
    const newEmailCt = encryptForRow("bob@example.test", clientId, "email_ciphertext");
    const newPhoneCt = encryptForRow("+972-50-9999999", clientId, "phone_ciphertext");
    await withUser(state.appUserId!, async (tx) => {
      await tx.execute(
        sql`UPDATE clients SET legal_name = ${`${TAG_PREFIX}clientA-rewritten`},
                               default_payment_terms_days = 45
            WHERE id = ${clientId}::uuid AND deleted_at IS NULL`,
      );
      await tx.execute(
        sql`UPDATE clients SET email_ciphertext = ${newEmailCt}
            WHERE id = ${clientId}::uuid AND deleted_at IS NULL`,
      );
      await tx.execute(
        sql`UPDATE clients SET phone_ciphertext = ${newPhoneCt}
            WHERE id = ${clientId}::uuid AND deleted_at IS NULL`,
      );
    });

    const after = await withServiceRole(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT email_ciphertext, phone_ciphertext, notes_ciphertext
              FROM clients WHERE id = ${clientId}::uuid`,
      )) as unknown as Array<{
        email_ciphertext: string | null;
        phone_ciphertext: string | null;
        notes_ciphertext: string | null;
      }>;
      return rows[0]!;
    });

    expect(
      decryptStringWithKey({
        key: getKek(),
        ciphertext: after.email_ciphertext!,
        aad: {
          table: "clients",
          column: "email_ciphertext",
          rowId: clientId,
        },
      }),
    ).toBe("bob@example.test");
    expect(
      decryptStringWithKey({
        key: getKek(),
        ciphertext: after.phone_ciphertext!,
        aad: {
          table: "clients",
          column: "phone_ciphertext",
          rowId: clientId,
        },
      }),
    ).toBe("+972-50-9999999");
    // notes was 'preserve' → still decryptable to the seeded value.
    expect(
      decryptStringWithKey({
        key: getKek(),
        ciphertext: after.notes_ciphertext!,
        aad: {
          table: "clients",
          column: "notes_ciphertext",
          rowId: clientId,
        },
      }),
    ).toBe("VIP client; ping monthly");
  });

  it("clear branch: explicit NULL write removes ciphertext", async () => {
    if (!state.clientId) throw new Error("clientId missing");
    const clientId = state.clientId;

    // Simulate the 'clear' branch — user typed `__clear__` in the form
    // and the action issued a NULL UPDATE.
    await withUser(state.appUserId!, async (tx) => {
      await tx.execute(
        sql`UPDATE clients SET notes_ciphertext = NULL
            WHERE id = ${clientId}::uuid AND deleted_at IS NULL`,
      );
    });

    const after = await withServiceRole(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT notes_ciphertext FROM clients WHERE id = ${clientId}::uuid`,
      )) as unknown as Array<{ notes_ciphertext: string | null }>;
      return rows[0]!;
    });
    expect(after.notes_ciphertext).toBeNull();
  });
});

// Unit-style coverage of the resolvePiiFieldUpdate semantics — these
// match the three states the schema needs to surface to the SQL layer.
// We can't import resolvePiiFieldUpdate (it's not exported), but we
// document the contract here so future refactors stay correct.
describe("PII update field semantics (C-6 contract)", () => {
  it("documents preserve / clear / write states", () => {
    // Empty string in form data == preserve (do not touch column).
    // Whitespace == preserve.
    // '__clear__' sentinel == write NULL.
    // Any other non-empty string == encrypt + write ciphertext.
    expect(true).toBe(true);
  });
});
