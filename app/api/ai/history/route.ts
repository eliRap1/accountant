// GET /api/ai/history
//
// Returns the caller's AI conversations + the messages on the active
// conversation. Layer 1 dependency: `ai_conversations` + `ai_messages`
// tables. When either is missing we fall through to an empty payload
// so the client can render the "no history yet" empty state.
//
// Response shape:
//   {
//     conversations: Array<{ id, title, createdAt, lastMessageAt }>,
//     messages: Array<{ id, role, text, createdAt }>,
//     conversationId: string | null,
//     schemaPresent: boolean,
//   }
//
// Decryption: `ai_messages` will eventually hold `content_ciphertext`
// columns encrypted with an envelope DEK (AAD = {table:'ai_messages',
// column:'content_ciphertext', rowId}). For Phase D the column is named
// `content_plaintext` in the migration plan, so the route reads either
// column and decrypts via `decryptColumn(...)` when the ciphertext
// variant is present.

import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { decryptStringWithDek } from "@/lib/security/encryption";

// `v1:<iv>:<authTag>:<ciphertext>` per encodeAesGcmString — recognising
// this prefix lets us distinguish encrypted ai_messages rows from
// legacy plaintext-only rows mid-migration.
function isEncryptedColumnValue(value: string): boolean {
  return /^v1:/.test(value);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProbeRow = { exists_count: string };
type ConvRow = {
  id: string;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
};
type MsgRow = {
  id: string;
  role: string;
  content_plaintext: string | null;
  content_ciphertext: string | null;
  dek_id: string | null;
  created_at: string;
};

async function probeTables(userId: string): Promise<{
  conversations: boolean;
  messages: boolean;
}> {
  try {
    return await withUser(userId, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT table_name FROM information_schema.tables
            WHERE table_name IN ('ai_conversations','ai_messages')`,
      )) as unknown as Array<{ table_name: string }>;
      return {
        conversations: rows.some((r) => r.table_name === "ai_conversations"),
        messages: rows.some((r) => r.table_name === "ai_messages"),
      };
    });
  } catch {
    return { conversations: false, messages: false };
  }
}

export async function GET(request: Request): Promise<Response> {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");

  const probe = await probeTables(user.appUserId);
  if (!probe.conversations) {
    return Response.json({
      conversations: [],
      messages: [],
      conversationId: null,
      schemaPresent: false,
    });
  }

  const { conversations, messages } = await withUser(
    user.appUserId,
    async (tx) => {
      const convRows = (await tx.execute(
        sql`SELECT id::text, title, created_at::text,
                   last_message_at::text
            FROM ai_conversations
            ORDER BY COALESCE(last_message_at, created_at) DESC
            LIMIT 50`,
      )) as unknown as ConvRow[];

      let msgRows: MsgRow[] = [];
      if (probe.messages && conversationId) {
        try {
          msgRows = (await tx.execute(
            sql`SELECT id::text, role::text,
                       content_plaintext, content_ciphertext, dek_id,
                       created_at::text
                FROM ai_messages
                WHERE conversation_id = ${conversationId}
                ORDER BY created_at ASC
                LIMIT 200`,
          )) as unknown as MsgRow[];
        } catch (err) {
          // Either column name drift mid-migration or RLS-empty result.
          // Silent: client treats as empty conversation.
          msgRows = [];
          // eslint-disable-next-line no-console
          console.warn("[api.ai.history] messages.read_failed", err);
        }
      }

      return { conversations: convRows, messages: msgRows };
    },
  );

  // Decrypt ciphertext rows where present. AAD per spec:
  // {table:'ai_messages', column:'content_ciphertext', rowId:<id>}.
  const decryptedMessages = await Promise.all(
    messages.map(async (m) => {
      let text = m.content_plaintext ?? "";
      if (
        m.content_ciphertext &&
        isEncryptedColumnValue(m.content_ciphertext) &&
        m.dek_id
      ) {
        try {
          text = await decryptStringWithDek({
            ciphertext: m.content_ciphertext,
            dekId: m.dek_id,
            aad: {
              table: "ai_messages",
              column: "content_ciphertext",
              rowId: m.id,
            },
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[api.ai.history] decrypt_failed", err);
          text = "";
        }
      }
      return {
        id: m.id,
        role: m.role,
        text,
        createdAt: m.created_at,
      };
    }),
  );

  return Response.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.created_at,
      lastMessageAt: c.last_message_at,
    })),
    messages: decryptedMessages,
    conversationId,
    schemaPresent: probe.conversations,
  });
}
