import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { businesses } from "./businesses";
import { users } from "./identity";

// Per-business CRM. Contact PII (email / phone / address notes) is stored
// as ciphertext via envelope encryption (AAD = {table, column, rowId}).
// vat_id is plaintext because IL tax law requires the customer's ID to
// appear on a tax invoice — validation lives in lib/invoices/ilValidate.ts.
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    legalName: text("legal_name").notNull(),
    vatId: text("vat_id"),
    emailCiphertext: text("email_ciphertext"),
    phoneCiphertext: text("phone_ciphertext"),
    addressStreet: text("address_street"),
    addressCity: text("address_city"),
    addressPostalCode: text("address_postal_code"),
    addressCountry: text("address_country"),
    defaultPaymentTermsDays: integer("default_payment_terms_days")
      .notNull()
      .default(14),
    defaultCurrency: text("default_currency").notNull().default("ILS"),
    notesCiphertext: text("notes_ciphertext"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("clients_business_legal_name_idx").on(table.businessId, table.legalName),
  ],
);

export const clientsRelations = relations(clients, ({ one, many }) => ({
  business: one(businesses, {
    fields: [clients.businessId],
    references: [businesses.id],
  }),
  portalTokens: many(clientPortalTokens),
}));

// Magic-link portal tokens for client-facing read-only portal access.
// Clients are NOT Better Auth users — the JWT is the credential. Each
// token row stores the SHA-256 hash of the raw JWT (not the JWT itself)
// so revocation checks are safe even if the DB is breached.
export const clientPortalTokens = pgTable(
  "client_portal_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    issuedByUserId: uuid("issued_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("client_portal_tokens_client_idx").on(table.clientId),
    index("client_portal_tokens_token_hash_idx").on(table.tokenHash),
  ],
);

export const clientPortalTokensRelations = relations(
  clientPortalTokens,
  ({ one }) => ({
    client: one(clients, {
      fields: [clientPortalTokens.clientId],
      references: [clients.id],
    }),
    issuedByUser: one(users, {
      fields: [clientPortalTokens.issuedByUserId],
      references: [users.id],
    }),
  }),
);
