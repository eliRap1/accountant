import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isRealNeonDb } from "./_helpers";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { users } from "@/db/schema/identity";
import { user as authUser } from "@/db/schema/auth";
import {
  encryptStringWithDek,
  decryptStringWithDek,
} from "@/lib/security/encryption";

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

// Per-run tag so seed rows can be cleaned up even if a test bails
// mid-flight. Each row carries this in its email.
const TAG_PREFIX = `ai-${randomUUID().slice(0, 8)}-`;

type Seed = {
  authUserAId: string;
  authUserBId: string;
  appUserAId: string;
  appUserBId: string;
};

const state: Partial<Seed> = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/ai-conversations] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

describeOrSkip("AI conversations — RLS + envelope encryption", () => {
  beforeAll(async () => {
    await withServiceRole(async (tx) => {
      const aAuthId = `${TAG_PREFIX}A-${randomUUID()}`;
      const bAuthId = `${TAG_PREFIX}B-${randomUUID()}`;

      await tx.insert(authUser).values([
        {
          id: aAuthId,
          name: `${TAG_PREFIX}A`,
          email: `${TAG_PREFIX}A@example.test`,
          emailVerified: true,
        },
        {
          id: bAuthId,
          name: `${TAG_PREFIX}B`,
          email: `${TAG_PREFIX}B@example.test`,
          emailVerified: true,
        },
      ]);

      const insertedA = await tx
        .insert(users)
        .values({ authUserId: aAuthId })
        .returning({ id: users.id });
      const insertedB = await tx
        .insert(users)
        .values({ authUserId: bAuthId })
        .returning({ id: users.id });

      const aId = insertedA[0]?.id;
      const bId = insertedB[0]?.id;
      if (!aId || !bId) throw new Error("seed: missing returning() id");

      state.authUserAId = aAuthId;
      state.authUserBId = bAuthId;
      state.appUserAId = aId;
      state.appUserBId = bId;
    });
  });

  afterAll(async () => {
    if (!state.appUserAId && !state.appUserBId) return;
    await withServiceRole(async (tx) => {
      const ids = [state.appUserAId, state.appUserBId].filter(
        (x): x is string => Boolean(x),
      );
      // ai_messages cascades from ai_conversations; ai_conversations
      // cascades from users (onDelete: cascade FK). Cleaning users
      // alone is enough but we delete the conversations explicitly so
      // a partial test run does not leave orphan ai_messages rows
      // referencing the cascade chain.
      for (const id of ids) {
        await tx.execute(
          sql`DELETE FROM ai_conversations WHERE user_id = ${id}`,
        );
        await tx.execute(sql`DELETE FROM users WHERE id = ${id}`);
      }
      const authIds = [state.authUserAId, state.authUserBId].filter(
        (x): x is string => Boolean(x),
      );
      for (const id of authIds) {
        await tx.execute(sql`DELETE FROM "user" WHERE id = ${id}`);
      }
      // Retire any DEKs minted by the encryption helpers during the
      // run so re-running the suite does not accumulate inactive rows.
      // We match on the per-user purpose prefix.
      for (const id of ids) {
        await tx.execute(
          sql`UPDATE data_encryption_keys
                 SET retired_at = COALESCE(retired_at, now()),
                     wrapped_dek = NULL,
                     wrapped_dek_iv = NULL,
                     wrapped_dek_auth_tag = NULL
               WHERE purpose = ${`ai:user:${id}:messages`}
                 AND retired_at IS NULL`,
        );
      }
    });
  });

  // ============================================================================
  // RLS — UserA cannot see UserB's conversations or messages.
  // ============================================================================
  it("RLS: A cannot read B's conversation; B cannot read A's", async () => {
    // A opens a conversation.
    const aConversation = await withUser(state.appUserAId!, async (tx) => {
      const inserted = (await tx.execute(
        sql`INSERT INTO ai_conversations (user_id, title)
            VALUES (${state.appUserAId}::uuid, 'A thread')
            RETURNING id::text AS id`,
      )) as unknown as Array<{ id: string }>;
      return inserted[0]!.id;
    });

    // B opens their own.
    const bConversation = await withUser(state.appUserBId!, async (tx) => {
      const inserted = (await tx.execute(
        sql`INSERT INTO ai_conversations (user_id, title)
            VALUES (${state.appUserBId}::uuid, 'B thread')
            RETURNING id::text AS id`,
      )) as unknown as Array<{ id: string }>;
      return inserted[0]!.id;
    });

    expect(aConversation).not.toBe(bConversation);

    // B reads conversations → sees only their own.
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id::text AS id FROM ai_conversations`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.some((r) => r.id === bConversation)).toBe(true);
    expect(seenByB.some((r) => r.id === aConversation)).toBe(false);

    // A reads conversations → sees only their own.
    const seenByA = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT id::text AS id FROM ai_conversations`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByA.some((r) => r.id === aConversation)).toBe(true);
    expect(seenByA.some((r) => r.id === bConversation)).toBe(false);
  });

  it("RLS: A cannot insert a message into B's conversation", async () => {
    // B owns a conversation.
    const bConversation = await withUser(state.appUserBId!, async (tx) => {
      const inserted = (await tx.execute(
        sql`INSERT INTO ai_conversations (user_id)
            VALUES (${state.appUserBId}::uuid)
            RETURNING id::text AS id`,
      )) as unknown as Array<{ id: string }>;
      return inserted[0]!.id;
    });

    // A tries to insert a message into B's conversation — must fail.
    // The INSERT policy on ai_messages requires the parent conversation
    // to be owned by app_current_user_id().
    await expect(
      withUser(state.appUserAId!, async (tx) => {
        await tx.execute(
          sql`INSERT INTO ai_messages
                (conversation_id, role, content_ciphertext, content_dek_id)
              VALUES
                (${bConversation}::uuid,
                 'user',
                 'v1:fake',
                 '00000000-0000-0000-0000-000000000000'::uuid)`,
        );
      }),
    ).rejects.toThrow();
  });

  it("RLS: A cannot SELECT messages from B's conversation", async () => {
    // Set up a fresh B-conversation with one message.
    const bConversation = await withUser(state.appUserBId!, async (tx) => {
      const inserted = (await tx.execute(
        sql`INSERT INTO ai_conversations (user_id)
            VALUES (${state.appUserBId}::uuid)
            RETURNING id::text AS id`,
      )) as unknown as Array<{ id: string }>;
      const cid = inserted[0]!.id;
      await tx.execute(
        sql`INSERT INTO ai_messages
              (conversation_id, role, content_ciphertext, content_dek_id)
            VALUES
              (${cid}::uuid,
               'user',
               'v1:not-real',
               '00000000-0000-0000-0000-000000000000'::uuid)`,
      );
      return cid;
    });

    // B sees their message.
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id::text AS id FROM ai_messages WHERE conversation_id = ${bConversation}::uuid`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(1);

    // A sees nothing — both for the messages-by-conversation-id query
    // (RLS-hidden) and for an unscoped SELECT (RLS-hidden).
    const seenByA = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT id::text AS id FROM ai_messages WHERE conversation_id = ${bConversation}::uuid`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByA.length).toBe(0);
  });

  // ============================================================================
  // Envelope encryption — DEK round-trip on content_ciphertext.
  // ============================================================================
  it("DEK round-trip: encrypted content decrypts back via AAD", async () => {
    const plaintext = `סודי — מה גובה המע""מ? ${randomUUID().slice(0, 8)}`;

    // A opens a conversation + inserts a row with placeholder ciphertext.
    const { conversationId, messageId } = await withUser(
      state.appUserAId!,
      async (tx) => {
        const conv = (await tx.execute(
          sql`INSERT INTO ai_conversations (user_id)
              VALUES (${state.appUserAId}::uuid)
              RETURNING id::text AS id`,
        )) as unknown as Array<{ id: string }>;
        const cid = conv[0]!.id;
        const msg = (await tx.execute(
          sql`INSERT INTO ai_messages
                (conversation_id, role, content_ciphertext, content_dek_id)
              VALUES
                (${cid}::uuid,
                 'user',
                 '',
                 '00000000-0000-0000-0000-000000000000'::uuid)
              RETURNING id::text AS id`,
        )) as unknown as Array<{ id: string }>;
        return { conversationId: cid, messageId: msg[0]!.id };
      },
    );

    // Encrypt under the user's DEK with row-bound AAD.
    const { ciphertext, dekId } = await encryptStringWithDek({
      purpose: `ai:user:${state.appUserAId}:messages`,
      plaintext,
      aad: {
        table: "ai_messages",
        column: "content_ciphertext",
        rowId: messageId,
      },
    });

    // UPDATE the placeholder with the real ciphertext + dek_id.
    await withUser(state.appUserAId!, async (tx) => {
      await tx.execute(
        sql`UPDATE ai_messages
              SET content_ciphertext = ${ciphertext},
                  content_dek_id = ${dekId}::uuid
            WHERE id = ${messageId}::uuid`,
      );
    });

    // Read it back via RLS-scoped SELECT and decrypt.
    const row = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id::text, content_ciphertext, content_dek_id::text
              FROM ai_messages
             WHERE id = ${messageId}::uuid
             LIMIT 1`,
      )) as unknown as Array<{
        id: string;
        content_ciphertext: string;
        content_dek_id: string;
      }>;
      return rows[0]!;
    });
    expect(row.content_ciphertext).toMatch(/^v1:/);

    const decoded = await decryptStringWithDek({
      ciphertext: row.content_ciphertext,
      dekId: row.content_dek_id,
      aad: {
        table: "ai_messages",
        column: "content_ciphertext",
        rowId: messageId,
      },
    });
    expect(decoded).toBe(plaintext);

    // AAD must include the row id — decrypting with a different rowId
    // throws (the message bytes belong to row M, not row N).
    await expect(
      decryptStringWithDek({
        ciphertext: row.content_ciphertext,
        dekId: row.content_dek_id,
        aad: {
          table: "ai_messages",
          column: "content_ciphertext",
          rowId: randomUUID(),
        },
      }),
    ).rejects.toThrow();

    // Sanity: conversationId we created is still RLS-readable for A.
    const visibleConv = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT id::text AS id FROM ai_conversations WHERE id = ${conversationId}::uuid`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(visibleConv.length).toBe(1);
  });

  // ============================================================================
  // Quota counter — counts only this user's messages this month.
  // ============================================================================
  it("quota counter: counts only the calling user's messages", async () => {
    // A inserts 3 user messages.
    await withUser(state.appUserAId!, async (tx) => {
      const conv = (await tx.execute(
        sql`INSERT INTO ai_conversations (user_id)
            VALUES (${state.appUserAId}::uuid)
            RETURNING id::text AS id`,
      )) as unknown as Array<{ id: string }>;
      const cid = conv[0]!.id;
      for (let i = 0; i < 3; i++) {
        await tx.execute(
          sql`INSERT INTO ai_messages
                (conversation_id, role, content_ciphertext, content_dek_id)
              VALUES
                (${cid}::uuid,
                 'user',
                 'v1:placeholder',
                 '00000000-0000-0000-0000-000000000000'::uuid)`,
        );
      }
    });

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const iso = monthStart.toISOString().slice(0, 10);

    // From A's perspective: at least the 3 we just inserted.
    const countA = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT COUNT(*)::text AS count
              FROM ai_messages
             WHERE created_at >= ${iso}::date
               AND role = 'user'`,
      );
    })) as unknown as Array<{ count: string }>;
    expect(Number(countA[0]?.count ?? "0")).toBeGreaterThanOrEqual(3);

    // B sees zero of A's messages.
    const countB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT COUNT(*)::text AS count
              FROM ai_messages
             WHERE created_at >= ${iso}::date
               AND role = 'user'`,
      );
    })) as unknown as Array<{ count: string }>;
    // B opened conversations earlier in this suite but did not insert
    // user-role messages from their own withUser context that count
    // against A's bucket. The test asserts isolation, not exact equality
    // (other tests in this file may have added rows under B).
    const bCount = Number(countB[0]?.count ?? "0");
    const aCount = Number(countA[0]?.count ?? "0");
    expect(bCount).toBeLessThan(aCount);
  });
});
