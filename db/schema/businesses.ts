import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  date,
  jsonb,
  integer,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

// IL legal entity classification. Drives 6111-line mapping, bookkeeping
// method default, and which forms a business is liable for.
export const entityTypeEnum = pgEnum("entity_type", [
  "patur",
  "morshe",
  "hevra_baam",
  "amuta",
  "shutfut",
]);

// VAT registration status (independent of entity_type — a חברה can be osek
// morshe or, rarely, osek patur during initial registration).
export const vatStatusEnum = pgEnum("vat_status", [
  "liable",
  "osek_patur",
  "osek_morshe",
  "exporter",
  "nonprofit",
]);

// פטור / שכיר use single-entry; ח.פ. and large מורשה require double-entry
// per IL Income Tax Ordinance ("ניהול ספרים תקין").
export const bookkeepingMethodEnum = pgEnum("bookkeeping_method", [
  "single_entry",
  "double_entry",
]);

// Per-invoice-type running counter. Keys MUST match invoiceTypeEnum values
// declared in db/schema/invoicing.ts (Layer 2). Cross-layer agreement is
// enforced by Phase C app code, not by DB.
export type NextInvoiceSequenceJsonb = {
  tax_invoice?: number;
  tax_invoice_receipt?: number;
  receipt?: number;
  credit_note?: number;
  proforma?: number;
  debit_note?: number;
  self_invoice?: number;
};

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    legalName: text("legal_name").notNull(),
    // Israeli business identifier (ח.פ. for חברה, ע.מ. for עוסק). Validated
    // via checksum at app layer (lib/invoices/ilValidate.ts).
    vatId: text("vat_id").notNull(),
    entityType: entityTypeEnum("entity_type").notNull(),
    vatStatus: vatStatusEnum("vat_status").notNull(),
    bookkeepingMethod: bookkeepingMethodEnum("bookkeeping_method").notNull(),
    // Tax-year end month (1-12). Israeli default = December; some חברות use
    // a fiscal year ending in different months on ITA approval.
    taxYearEndMonth: integer("tax_year_end_month").notNull().default(12),
    // Advance-tax rate (מקדמות) — set by ITA at registration, updated annually
    // based on prior-year revenue. Stored as percentage with 2 decimals.
    advanceTaxRatePct: numeric("advance_tax_rate_pct", {
      precision: 5,
      scale: 2,
    }),
    // Income-tax withholding file (תיק ניכויים) — required for businesses
    // with payroll; nullable otherwise.
    tikNikuyim: text("tik_nikuyim"),
    defaultCurrency: text("default_currency").notNull().default("ILS"),
    nextInvoiceSequenceJsonb: jsonb("next_invoice_sequence_jsonb")
      .$type<NextInvoiceSequenceJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    addressStreet: text("address_street"),
    addressCity: text("address_city"),
    addressPostalCode: text("address_postal_code"),
    addressCountry: text("address_country").notNull().default("IL"),
    logoBlobUrl: text("logo_blob_url"),
    signatureBlobUrl: text("signature_blob_url"),
    ilMunicipalAuthority: text("il_municipal_authority"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("businesses_owner_idx").on(table.ownerUserId),
    index("businesses_vat_id_idx").on(table.vatId),
  ],
);

// Append-only history of vat_status / entity_type transitions. Every change
// to businesses.{entity_type, vat_status} writes a row here in the same
// transaction. PCN874 / form 6111 generators consult this for period-correct
// status when generating retrospective filings.
export const businessVatStatusHistory = pgTable(
  "business_vat_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    vatStatus: vatStatusEnum("vat_status").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    reason: text("reason"),
    changedByUserId: uuid("changed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("business_vat_status_history_business_idx").on(table.businessId),
    index("business_vat_status_history_effective_idx").on(
      table.businessId,
      table.effectiveFrom,
    ),
  ],
);

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  owner: one(users, {
    fields: [businesses.ownerUserId],
    references: [users.id],
  }),
  vatStatusHistory: many(businessVatStatusHistory),
}));

export const businessVatStatusHistoryRelations = relations(
  businessVatStatusHistory,
  ({ one }) => ({
    business: one(businesses, {
      fields: [businessVatStatusHistory.businessId],
      references: [businesses.id],
    }),
    changedByUser: one(users, {
      fields: [businessVatStatusHistory.changedByUserId],
      references: [users.id],
    }),
  }),
);
