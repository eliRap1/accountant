import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export type UserConsentJsonb = {
  termsAcceptedAt?: string;
  privacyAcceptedAt?: string;
  disclaimerAcceptedAt?: string;
  marketingOptInAt?: string | null;
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    locale: text("locale").notNull().default("he-IL"),
    country: text("country").notNull().default("IL"),
    dobCiphertext: text("dob_ciphertext"),
    nationalIdCiphertext: text("national_id_ciphertext"),
    consentJsonb: jsonb("consent_jsonb").$type<UserConsentJsonb>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    // Soft delete window — IL 7yr tax-record retention requires we hold
    // certain rows past user-facing deletion. PII is destroyed via
    // envelope-encryption DEK retirement, not row removal.
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    uniqueIndex("users_auth_user_id_idx").on(table.authUserId),
  ],
);

export const usersRelations = relations(users, ({ one }) => ({
  authUser: one(user, {
    fields: [users.authUserId],
    references: [user.id],
  }),
}));
