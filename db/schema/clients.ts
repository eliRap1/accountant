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

export const clientsRelations = relations(clients, ({ one }) => ({
  business: one(businesses, {
    fields: [clients.businessId],
    references: [businesses.id],
  }),
}));
