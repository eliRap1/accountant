import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { businesses } from "./businesses";

// AI conversations + messages (Phase D Layer 1 dep).
//
// The AI tax-advisor stores the user's chat history so threads survive a
// page reload and so the quota counter has a real row source to read
// from. Content is envelope-encrypted at rest:
//
//   * `content_ciphertext` is the AES-256-GCM ciphertext produced by the
//     unwrapped DEK for purpose
//     `ai:user:<userId>:messages` (see DEK purpose convention below).
//   * `content_dek_id` is the FK-style ref to `data_encryption_keys.id`.
//     We do not enforce a Postgres FK here because the encryption layer
//     intentionally retires DEKs (right-of-erasure crypto-shred) — a
//     hard FK would block retirement and surface as a cascade failure.
//   * AAD per spec: {table:'ai_messages', column:'content_ciphertext',
//     rowId:<message_id>}. Cross-row decrypt attempts fail at the AAD
//     check before any data is returned (see encryption-aad.test.ts).
//
// DEK purpose convention: `ai:user:<userId>:messages`. One DEK per user
// scopes the blast radius of a leaked DEK to one user's chat history.
// Right-of-erasure for AI history = `retireDek(getActiveDek('ai:user:<userId>:messages'))`
// in the account-delete cron, which crypto-shreds every ai_messages row
// belonging to that user without touching the 7yr-retained rows (we keep
// the ciphertext bytes; the wrapped key material is zeroed).
//
// Why we keep BOTH a per-user FK (`ai_conversations.user_id`) AND an
// optional `business_id`: the AI advisor is user-scoped (one chat lives
// across all businesses owned by the user), but some questions are
// business-scoped (the model needs the active business context for
// snapshot generation). The optional `business_id` records WHICH business
// was active at thread start so the snapshot context the user sees on
// reload matches the snapshot the model originally ran against.
//
// Summary fields (`summary_ciphertext` + `summary_dek_id`) are reserved
// for the rolling-summary feature (planned Phase D.3) where threads
// longer than the model context window get a per-thread compressed
// summary. Storing it encrypted under the same DEK purpose keeps the
// erasure semantics intact.

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, {
      onDelete: "set null",
    }),
    // Plaintext title — model-generated short label (≤80 chars). Not PII
    // in the threat model: the user types the prompts that produce the
    // title, so anything sensitive is already in content_ciphertext.
    title: text("title"),
    summaryCiphertext: text("summary_ciphertext"),
    summaryDekId: uuid("summary_dek_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_conversations_user_idx").on(table.userId, table.updatedAt),
    index("ai_conversations_business_idx").on(table.businessId),
  ],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    // `user` | `assistant` | `system` | `tool`. Plain text enum because
    // the AI SDK v6 message roles are an open set (tool responses are
    // their own role).
    role: text("role").notNull(),
    contentCiphertext: text("content_ciphertext").notNull(),
    contentDekId: uuid("content_dek_id").notNull(),
    // Tool-call metadata. Not encrypted because the FUNCTION names are
    // schema; the ARGUMENTS to those functions are not sensitive
    // (tax-engine inputs are reconstructable from the underlying ledger
    // rows which are themselves RLS-scoped). Persisted as JSONB so we
    // can index later if we add tool-call analytics.
    toolCallsJsonb: jsonb("tool_calls_jsonb"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    // Quota counter reads (created_at >= month_start, role='user') —
    // indexed via the conversation FK first; quota scan is small enough
    // (one user's monthly traffic) that the conversation-scoped index
    // suffices without a dedicated user_id index.
  ],
);

export const aiConversationsRelations = relations(
  aiConversations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [aiConversations.userId],
      references: [users.id],
    }),
    business: one(businesses, {
      fields: [aiConversations.businessId],
      references: [businesses.id],
    }),
    messages: many(aiMessages),
  }),
);

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, {
    fields: [aiMessages.conversationId],
    references: [aiConversations.id],
  }),
}));
