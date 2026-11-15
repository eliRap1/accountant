import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { businesses } from "./businesses";

// Bank connections — AISP-licensed live-link accounts.
//
// STUB IMPLEMENTATION — Salt Edge integration pending vendor signoff.
// Once the contract lands the `provider` column will move from 'stub'
// to 'salt_edge', and `provider_connection_id` will be populated by the
// Salt Edge webhook. The `consent_expires_at` and `metadata_jsonb`
// columns mirror Salt Edge's data shape exactly so the swap is
// mechanical (no migration needed).
//
// Intentionally kept separate from `processor_sync_credentials`:
//   - Banks are AISP-licensed (read-only Open Banking data).
//   - Card processors are acquiring gateways (transaction pull).
// These are different regulatory regimes and different data shapes.

export const bankConnections = pgTable(
  "bank_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    bankSlug: text("bank_slug").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("pending"),
    provider: text("provider").notNull().default("stub"),
    providerConnectionId: text("provider_connection_id"),
    consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    metadataJsonb: jsonb("metadata_jsonb")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("bank_connections_business_idx").on(table.businessId),
  ],
);

export const bankConnectionsRelations = relations(
  bankConnections,
  ({ one }) => ({
    business: one(businesses, {
      fields: [bankConnections.businessId],
      references: [businesses.id],
    }),
  }),
);
