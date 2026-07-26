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
  bigint,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { businesses } from "./businesses";
import { dataEncryptionKeys } from "./ops";

// Owner / shareholder compensation flows. ח.פ. only — app-layer guard
// rejects rows for businesses whose entity_type is not `hevra_baam`
// (CPA review § 3 step 3 highlighted the ח.פ.-specific deemed-dividend
// rule under IL § 3(ט1)).
//
//  `salary`                       — owner-employee wage component
//  `draw`                         — non-wage owner draw (typically עצמאי)
//  `dividend`                     — declared dividend; carries WHT-at-source
//  `loan_to_shareholder`          — outstanding shareholder loan
//  `shareholder_loan_repayment`   — repayment leg of the above
export const ownerCompensationKindEnum = pgEnum("owner_compensation_kind", [
  "salary",
  "draw",
  "dividend",
  "loan_to_shareholder",
  "shareholder_loan_repayment",
]);

// Tax-treatment metadata. JSONB shape covers § 3(ט1) reclassification
// fields, dividend WHT, and arbitrary annotations. The CPA council § 3
// step 3-4 flagged that the WHT amount + rate should be queryable;
// future migration may promote them to dedicated columns when the
// surface is wired in Phase D.
export type OwnerCompensationTaxTreatmentJsonb = {
  whtAmountMinor?: number;
  whtRatePct?: number;
  outstandingAtYearEndMinor?: number;
  reclassificationDate?: string;
  deemedInterestMinor?: number;
  notes?: string;
  meta?: Record<string, unknown>;
};

export const ownerCompensation = pgTable(
  "owner_compensation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: ownerCompensationKindEnum("kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    taxTreatmentJsonb: jsonb("tax_treatment_jsonb")
      .$type<OwnerCompensationTaxTreatmentJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("owner_compensation_business_period_idx").on(
      table.businessId,
      table.periodStart,
    ),
    index("owner_compensation_owner_idx").on(table.ownerUserId),
  ],
);

// Heuristic flag categories. New categories should be added to the enum
// in a separate migration so historical rows remain decodable.
//
//  `round_number`            — suspiciously round invoice / expense amount
//  `weekend_cash`            — cash receipt dated Friday/Saturday
//  `vendor_new_high_value`   — first-ever payment to vendor exceeds threshold
//  `split_below_threshold`   — two invoices that together cross the
//                               allocation threshold but each falls below
//  `unusual_vat_rate`        — VAT rate outside expected 0 / 18 set
//  `large_cash_payment`      — cash > ITA cash-limit threshold
export const riskFlagKindEnum = pgEnum("risk_flag_kind", [
  "round_number",
  "weekend_cash",
  "vendor_new_high_value",
  "split_below_threshold",
  "unusual_vat_rate",
  "large_cash_payment",
]);

export const riskFlagSeverityEnum = pgEnum("risk_flag_severity", [
  "info",
  "warning",
  "critical",
]);

export type RiskFlagEvidenceJsonb = Record<string, unknown>;

// Compliance "yellow flag" surface. Generators (see lib/risk/* in future
// phase) emit rows; the dashboard / AI advisor consume them. Links to
// invoice / transaction are loose (no FK) because either side can be
// soft-deleted independently and we want flags to survive as audit trail.
export const riskFlags = pgTable(
  "risk_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    kind: riskFlagKindEnum("kind").notNull(),
    severity: riskFlagSeverityEnum("severity").notNull().default("info"),
    evidenceJsonb: jsonb("evidence_jsonb")
      .$type<RiskFlagEvidenceJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    resolvedAt: timestamp("resolved_at"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    linkedInvoiceId: uuid("linked_invoice_id"),
    linkedTransactionId: uuid("linked_transaction_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("risk_flags_business_idx").on(table.businessId),
    index("risk_flags_business_unresolved_idx")
      .on(table.businessId, table.createdAt)
      .where(sql`resolved_at IS NULL`),
  ],
);

// Period-end inventory count snapshot. Items JSONB carries the SKU /
// quantity / value-per-item triplet for each row counted. total_value_minor
// is denormalised so the dashboard can render an "inventory on hand" KPI
// without exploding the JSONB.
export type InventoryItemsJsonb = Array<{
  sku?: string;
  description?: string;
  quantity?: number;
  unitCostMinor?: number;
  totalMinor?: number;
}>;

export const inventoryCounts = pgTable(
  "inventory_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    countDate: date("count_date").notNull(),
    itemsJsonb: jsonb("items_jsonb")
      .$type<InventoryItemsJsonb>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    totalValueMinor: bigint("total_value_minor", { mode: "bigint" }).notNull(),
    countedByUserId: uuid("counted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("inventory_counts_business_date_idx").on(
      table.businessId,
      table.countDate,
    ),
  ],
);

// ביקורת רשות המסים bundle artifact (Plan v4 § Phase E / CPA council § 8).
// Each row is a generated ZIP blob URL + manifest. The manifest JSONB
// describes every artifact + provenance (which PCN874 export, which
// invoices, which receipts). Step-up gated at INSERT (build) and at
// download (file fetch).
export type AuditPackageManifestJsonb = {
  invoiceIds?: string[];
  receiptIds?: string[];
  transactionIds?: string[];
  taxFilingIds?: string[];
  payrollRunIds?: string[];
  artifacts?: Array<{
    kind: string;
    refId: string;
    provenance?: string;
    bytes?: number;
  }>;
  meta?: Record<string, unknown>;
};

export const auditPackages = pgTable(
  "audit_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    manifestJsonb: jsonb("manifest_jsonb")
      .$type<AuditPackageManifestJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    fileBlobUrl: text("file_blob_url"),
    fileKeyId: uuid("file_key_id").references(() => dataEncryptionKeys.id, {
      onDelete: "restrict",
    }),
    totalArtifacts: integer("total_artifacts").notNull().default(0),
    // SHA-256 hex of the plaintext ZIP bytes (before encryption). Stored
    // in the DB row only — NOT in the manifest inside the ZIP — so the
    // hash is always verifiable against the downloaded+decrypted archive
    // without a self-referential circular dependency. Inspectors verify:
    //   sha256(decryptedZip) === audit_packages.sha256_hex
    sha256Hex: text("sha256_hex"),
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
    index("audit_packages_business_period_idx").on(
      table.businessId,
      table.periodEnd,
    ),
  ],
);

export const ownerCompensationRelations = relations(
  ownerCompensation,
  ({ one }) => ({
    business: one(businesses, {
      fields: [ownerCompensation.businessId],
      references: [businesses.id],
    }),
    owner: one(users, {
      fields: [ownerCompensation.ownerUserId],
      references: [users.id],
    }),
  }),
);

export const riskFlagsRelations = relations(riskFlags, ({ one }) => ({
  business: one(businesses, {
    fields: [riskFlags.businessId],
    references: [businesses.id],
  }),
  resolvedByUser: one(users, {
    fields: [riskFlags.resolvedByUserId],
    references: [users.id],
  }),
}));

export const inventoryCountsRelations = relations(
  inventoryCounts,
  ({ one }) => ({
    business: one(businesses, {
      fields: [inventoryCounts.businessId],
      references: [businesses.id],
    }),
    countedByUser: one(users, {
      fields: [inventoryCounts.countedByUserId],
      references: [users.id],
    }),
  }),
);

export const auditPackagesRelations = relations(auditPackages, ({ one }) => ({
  business: one(businesses, {
    fields: [auditPackages.businessId],
    references: [businesses.id],
  }),
  generatedByUser: one(users, {
    fields: [auditPackages.generatedByUserId],
    references: [users.id],
  }),
  fileKey: one(dataEncryptionKeys, {
    fields: [auditPackages.fileKeyId],
    references: [dataEncryptionKeys.id],
  }),
}));
