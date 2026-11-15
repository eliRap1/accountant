import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  date,
  jsonb,
  bigint,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { businesses } from "./businesses";
import { clients } from "./clients";
import { dataEncryptionKeys } from "./ops";

// IL tax filing artifact types. Names match ITA form codes verified by
// CPA council on 2026-05-16 (inherited-verify; see
// docs/council/2026-05-16-cpa-review.md § 10).
//
// `pcn874`     — monthly VAT digital report
// `form_6111`  — uniform digital annual filing schedule (CoA-mapped)
// `form_102`   — monthly Bituach Leumi employer report
// `form_1301`  — annual return — עצמאי / individual
// `form_1214`  — annual return — חברה / company
// `form_126`   — annual employer return (per-employee wages summary)
// `form_856`   — annual WHT return (we-withheld-from-suppliers)
export const taxFilingKindEnum = pgEnum("tax_filing_kind", [
  "pcn874",
  "form_6111",
  "form_102",
  "form_1301",
  "form_1214",
  "form_126",
  "form_856",
]);

// Status lifecycle:
//   draft       — generator was invoked but artifact not yet finalised
//   generated   — artifact written; ready for human review
//   downloaded  — user fetched the file (step-up gated; writes auth event)
//   submitted   — owner confirmed external submission to ITA / SHAAM / BTL
//                  + step-up; freezes the row.
// Status transitions enforced by app layer; DB just stores the value.
export const taxFilingStatusEnum = pgEnum("tax_filing_status", [
  "draft",
  "generated",
  "downloaded",
  "submitted",
]);

export type TaxFilingTotalsJsonb = Record<string, unknown>;
// Audit trail: row-level provenance keyed by source-record id (invoice id,
// receipt id, transaction id). The CPA council § 2 step 4 requires the
// PCN874 row reconstruction be possible from underlying rows, not a
// black-box blob.
export type TaxFilingInputsJsonb = {
  invoiceIds?: string[];
  receiptIds?: string[];
  transactionIds?: string[];
  payrollRunIds?: string[];
  meta?: Record<string, unknown>;
};

export const taxFilings = pgTable(
  "tax_filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    kind: taxFilingKindEnum("kind").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    status: taxFilingStatusEnum("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at"),
    // Asmachta = ITA confirmation reference after submission. Plaintext —
    // the user pastes the number returned by the regulator's portal.
    submittedAsmachta: text("submitted_asmachta"),
    fileBlobUrl: text("file_blob_url"),
    fileKeyId: uuid("file_key_id").references(() => dataEncryptionKeys.id, {
      onDelete: "restrict",
    }),
    fileMime: text("file_mime"),
    totalsJsonb: jsonb("totals_jsonb")
      .$type<TaxFilingTotalsJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    inputsJsonb: jsonb("inputs_jsonb")
      .$type<TaxFilingInputsJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    generatedByUserId: uuid("generated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("tax_filings_business_kind_period_idx").on(
      table.businessId,
      table.kind,
      table.periodEnd,
    ),
    index("tax_filings_status_idx").on(table.status),
  ],
);

// מקדמות — income-tax advance payments per period. Rate is set by ITA
// each year based on prior-year revenue; stored on businesses.advance_tax_rate_pct
// but snapshotted here at the time the advance was declared.
export const taxAdvances = pgTable(
  "tax_advances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    declaredRevenueMinor: bigint("declared_revenue_minor", {
      mode: "bigint",
    }).notNull(),
    ratePct: numeric("rate_pct", { precision: 5, scale: 2 }).notNull(),
    amountDueMinor: bigint("amount_due_minor", { mode: "bigint" }).notNull(),
    paidAt: timestamp("paid_at"),
    asmachta: text("asmachta"),
    paidAmountMinor: bigint("paid_amount_minor", { mode: "bigint" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("tax_advances_business_period_idx").on(
      table.businessId,
      table.periodStart,
    ),
  ],
);

// WHT certificates that *clients* present to us (they withhold from us at
// payment time). The scanned certificate PDF is encrypted via envelope DEK.
// Used by lib/tax/il when applying ניכוי במקור against amounts received.
export const clientWhtCertificates = pgTable(
  "client_wht_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    certificateNumber: text("certificate_number"),
    ratePct: numeric("rate_pct", { precision: 5, scale: 2 }).notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    scannedBlobUrl: text("scanned_blob_url"),
    scannedKeyId: uuid("scanned_key_id").references(
      () => dataEncryptionKeys.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("client_wht_certificates_client_idx").on(table.clientId),
    index("client_wht_certificates_valid_idx").on(
      table.clientId,
      table.validFrom,
    ),
  ],
);

// Supplier WHT rates — *we* withhold from suppliers at payment time. Feeds
// the annual Form 856 generator. Supplier identity is stored as ciphertext
// because the supplier roster is a competitive asset; the per-row DEK lives
// in `dek_id`. CPA review § 3 step 5 highlighted the gap that the Form 856
// generator needs row-level evidence here.
export const supplierWhtRates = pgTable(
  "supplier_wht_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    supplierNameCiphertext: text("supplier_name_ciphertext"),
    supplierVatIdCiphertext: text("supplier_vat_id_ciphertext"),
    dekId: uuid("dek_id").references(() => dataEncryptionKeys.id, {
      onDelete: "restrict",
    }),
    ratePct: numeric("rate_pct", { precision: 5, scale: 2 }).notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    notesCiphertext: text("notes_ciphertext"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("supplier_wht_rates_business_idx").on(table.businessId),
  ],
);

export const taxFilingsRelations = relations(taxFilings, ({ one }) => ({
  business: one(businesses, {
    fields: [taxFilings.businessId],
    references: [businesses.id],
  }),
  generatedByUser: one(users, {
    fields: [taxFilings.generatedByUserId],
    references: [users.id],
  }),
  fileKey: one(dataEncryptionKeys, {
    fields: [taxFilings.fileKeyId],
    references: [dataEncryptionKeys.id],
  }),
}));

export const taxAdvancesRelations = relations(taxAdvances, ({ one }) => ({
  business: one(businesses, {
    fields: [taxAdvances.businessId],
    references: [businesses.id],
  }),
}));

export const clientWhtCertificatesRelations = relations(
  clientWhtCertificates,
  ({ one }) => ({
    client: one(clients, {
      fields: [clientWhtCertificates.clientId],
      references: [clients.id],
    }),
    scannedKey: one(dataEncryptionKeys, {
      fields: [clientWhtCertificates.scannedKeyId],
      references: [dataEncryptionKeys.id],
    }),
  }),
);

export const supplierWhtRatesRelations = relations(
  supplierWhtRates,
  ({ one }) => ({
    business: one(businesses, {
      fields: [supplierWhtRates.businessId],
      references: [businesses.id],
    }),
    dek: one(dataEncryptionKeys, {
      fields: [supplierWhtRates.dekId],
      references: [dataEncryptionKeys.id],
    }),
  }),
);
