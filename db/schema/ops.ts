import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  jsonb,
  integer,
  customType,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

// Drizzle has no first-class `bytea` helper; declare a customType once and reuse.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// In-app notification inbox.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payloadJsonb: jsonb("payload_jsonb")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("notifications_user_unread_idx")
      .on(table.userId, table.createdAt)
      .where(sql`read_at IS NULL`),
  ],
);

// Append-only audit log. Service-role read only (RLS revoked from app_user).
// 7-year retention to align with IL tax-record norms.
export const authEventTypeEnum = pgEnum("auth_event_type", [
  "sign_in",
  "sign_in_failed",
  "sign_out",
  "password_change",
  "password_reset_request",
  "password_reset_success",
  "mfa_enroll",
  "mfa_disable",
  "mfa_challenge_success",
  "mfa_challenge_failed",
  "passkey_register",
  "passkey_remove",
  "recovery_code_used",
  "suspicious_ip",
  "step_up_grant",
  "step_up_deny",
  "engagement_invited",
  "engagement_accepted",
  "engagement_revoked",
  "vat_status_transition",
  "account_deleted",
]);

export const authEvents = pgTable(
  "auth_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authUserId: text("auth_user_id"),
    eventType: authEventTypeEnum("event_type").notNull(),
    // SHA-256 hashes — never store raw IP / UA. Hashing keys are app-side
    // constants so the same IP from the same client produces a stable hash
    // across rows, enabling burst-detection without exposing PII.
    ipHash: bytea("ip_hash"),
    uaHash: bytea("ua_hash"),
    metadataJsonb: jsonb("metadata_jsonb")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("auth_events_user_created_idx").on(table.userId, table.createdAt),
    index("auth_events_type_created_idx").on(table.eventType, table.createdAt),
    index("auth_events_ip_hash_idx").on(table.ipHash, table.createdAt),
  ],
);

// Postgres-backed rate-limit store. Single source of truth for Better Auth's
// rate-limit plugin and app-level guards. Service-role only.
//
// Bucket strategy: (kind, key, window_start) composite uniqueness. Writers
// upsert with `ON CONFLICT (...) DO UPDATE SET hit_count = hit_count + 1`.
// Old buckets purged by cron `/api/cron/usage-archive`.
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    windowStart: timestamp("window_start").notNull(),
    hitCount: integer("hit_count").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("rate_limit_buckets_lookup_idx").on(
      table.kind,
      table.key,
      table.windowStart,
    ),
    index("rate_limit_buckets_expires_idx").on(table.expiresAt),
  ],
);

// Envelope encryption. KEK lives in env (DATA_ENCRYPTION_KEY). Per-purpose
// DEKs are generated, wrapped under the KEK with AES-256-GCM, and stored
// here. AES-GCM encryption of PII columns uses the unwrapped DEK as the
// data key; AAD remains {table, column, rowId}.
//
// Rotation = generate a new DEK with same purpose, mark old as retired_at.
// PII-destruction-by-DEK-retirement = set retired_at to the destruction
// timestamp and drop the wrapped_dek bytes (zero them out). The data is
// then mathematically unrecoverable even if the row remains.
export const dataEncryptionKeys = pgTable(
  "data_encryption_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose").notNull(),
    wrappedDek: bytea("wrapped_dek"),
    wrappedDekIv: bytea("wrapped_dek_iv"),
    wrappedDekAuthTag: bytea("wrapped_dek_auth_tag"),
    kekVersion: integer("kek_version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    retiredAt: timestamp("retired_at"),
    destructionNotes: text("destruction_notes"),
  },
  (table) => [
    uniqueIndex("data_encryption_keys_purpose_active_idx")
      .on(table.purpose)
      .where(sql`retired_at IS NULL`),
  ],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const authEventsRelations = relations(authEvents, ({ one }) => ({
  user: one(users, {
    fields: [authEvents.userId],
    references: [users.id],
  }),
}));
