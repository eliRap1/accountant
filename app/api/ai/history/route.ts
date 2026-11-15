// GET /api/ai/history
//
// Returns the caller's AI conversations + the messages on the active
// conversation. Backed by `ai_conversations` + `ai_messages` (migrations
// 0011 + 0012). When the schema is missing (fresh install pre-migration)
// the route still returns an empty payload so the client renders the
// "no history yet" empty state instead of crashing.
//
// Response shape:
//   {
//     conversations: Array<{ id, title, createdAt, lastMessageAt }>,
//     messages: Array<{ id, role, text, createdAt }>,
//     conversationId: string | null,
//     schemaPresent: boolean,
//   }
//
// Decryption: `ai_messages.content_ciphertext` is AES-256-GCM under an
// envelope DEK (purpose `ai:user:<userId>:messages`). AAD per spec:
// {table:'ai_messages', column:'content_ciphertext', rowId:<id>}.

import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { decryptStringWithDek } from "@/lib/security/encryption";

// `v1:<iv>:<authTag>:<ciphertext>` per encodeAesGcmString — recognising
// this prefix lets us distinguish a real encrypted ai_messages row from
// the empty-string placeholder used by the insert-then-update flow in
// the chat route (a placeholder slipped past the UPDATE step is a bug
// but we render it as empty rather than crashing the conversation).
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
  updated_at: string | null;
};
type MsgRow = {
  id: string;
  role: string;
  content_ciphertext: string;
  content_dek_id: string;
  created_at: string;
};

async function probeTables(_userId: string): Promise<{
  conversations: boolean;
  messages: boolean;
}> {
  try {
    const { dbService } = await import("@/db/client");
    const rows = (await dbService.execute(
      sql`SELECT to_regclass('public.ai_conversations') IS NOT NULL AS conversations,
                 to_regclass('public.ai_messages')      IS NOT NULL AS messages`,
    )) as unknown as Array<{ conversations: boolean; messages: boolean }>;
    return {
      conversations: Boolean(rows[0]?.conversations),
      messages: Boolean(rows[0]?.messages),
    };
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
                   updated_at::text
            FROM ai_conversations
            ORDER BY updated_at DESC
            LIMIT 50`,
      )) as unknown as ConvRow[];

      let msgRows: MsgRow[] = [];
      if (probe.messages && conversationId) {
        try {
          msgRows = (await tx.execute(
            sql`SELECT id::text, role::text,
                       content_ciphertext, content_dek_id::text,
                       created_at::text
                FROM ai_messages
                WHERE conversation_id = ${conversationId}
                ORDER BY created_at ASC
                LIMIT 200`,
          )) as unknown as MsgRow[];
        } catch (err) {
          // RLS-empty result OR conversation belongs to another user.
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
      let text = "";
      if (
        m.content_ciphertext &&
        isEncryptedColumnValue(m.content_ciphertext) &&
        m.content_dek_id
      ) {
        try {
          text = await decryptStringWithDek({
            ciphertext: m.content_ciphertext,
            dekId: m.content_dek_id,
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
      lastMessageAt: c.updated_at,
    })),
    messages: decryptedMessages,
    conversationId,
    schemaPresent: probe.conversations,
  });
}
