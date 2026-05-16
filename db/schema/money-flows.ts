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
  boolean,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { businesses } from "./businesses";
import { dataEncryptionKeys } from "./ops";
import { financialAccounts, journalEntries } from "./ledger";
import { invoices } from "./invoicing";

export const transactionDirectionEnum = pgEnum("transaction_direction", [
  "income",
  "expense",
  "transfer",
]);

export const transactionSourceEnum = pgEnum("transaction_source", [
  "manual",
  "bank_import",
  "processor_sync",
  "ocr",
  "journal",
]);

export type TransactionMetadataJsonb = Record<string, unknown>;

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // Nullable: unallocated transactions stay in an "inbox" until matched
    // to a real financial account (e.g. fresh OCR output without a paired
    // account yet).
    financialAccountId: uuid("financial_account_id").references(
      () => financialAccounts.id,
      { onDelete: "set null" },
    ),
    direction: transactionDirectionEnum("direction").notNull(),
    // References chart_of_accounts via (business_id, code); no DB FK.
    categoryCode: text("category_code"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("ILS"),
    description: text("description"),
    txnDate: date("txn_date").notNull(),
    linkedInvoiceId: uuid("linked_invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    // Receipts FK kept loose — receipt rows can be deleted independently
    // of a paired transaction, and we want to keep the txn around with
    // a NULL link rather than cascade.
    linkedReceiptId: uuid("linked_receipt_id"),
    linkedJournalEntryId: uuid("linked_journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "set null" },
    ),
    source: transactionSourceEnum("source").notNull(),
    // Dedup key for processor / bank imports. Combined with `source` it is
    // globally unique within the table so re-imports are idempotent.
    sourceExternalId: text("source_external_id"),
    metadataJsonb: jsonb("metadata_jsonb")
      .$type<TransactionMetadataJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("transactions_business_date_idx").on(table.businessId, table.txnDate),
    uniqueIndex("transactions_source_external_idx")
      .on(table.source, table.sourceExternalId)
      .where(sql`source_external_id IS NOT NULL`),
    index("transactions_account_idx").on(table.financialAccountId),
  ],
);

export const receiptStatusEnum = pgEnum("receipt_status", [
  "pending_review",
  "approved",
  "rejected",
]);

export const receiptSourceEnum = pgEnum("receipt_source", [
  "upload",
  "email_in",
  "manual",
  "processor_sync",
]);

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    status: receiptStatusEnum("status").notNull().default("pending_review"),
    source: receiptSourceEnum("source").notNull(),
    ocrTextCiphertext: text("ocr_text_ciphertext"),
    parsedAmountMinor: bigint("parsed_amount_minor", { mode: "bigint" }),
    parsedVatMinor: bigint("parsed_vat_minor", { mode: "bigint" }),
    parsedDate: date("parsed_date"),
    parsedVendorCiphertext: text("parsed_vendor_ciphertext"),
    // DEK rows used at encrypt time, so decrypt no longer depends on
    // `getActiveDek(purpose)` (which silently breaks across rotations).
    // Nullable for backfill compatibility.
    parsedVendorDekId: uuid("parsed_vendor_dek_id").references(
      () => dataEncryptionKeys.id,
      { onDelete: "restrict" },
    ),
    ocrTextDekId: uuid("ocr_text_dek_id").references(
      () => dataEncryptionKeys.id,
      { onDelete: "restrict" },
    ),
    categoryCode: text("category_code"),
    businessUsePct: numeric("business_use_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("100.00"),
    vatRecoverableMinor: bigint("vat_recoverable_minor", { mode: "bigint" }),
    fileBlobUrl: text("file_blob_url"),
    fileKeyId: uuid("file_key_id").references(() => dataEncryptionKeys.id, {
      onDelete: "restrict",
    }),
    // No FK declared — receipts can exist without a paired transaction
    // (e.g. expense awaiting categorisation). The app layer links them.
    linkedTransactionId: uuid("linked_transaction_id"),
    // Stable handle on the processor-side receipt id for the
    // processor-sync ingest path. Populated only when source =
    // 'processor_sync'. Partial unique on (business_id, source,
    // external_ref) enforces idempotency — see migration 0013.
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("receipts_business_status_idx").on(table.businessId, table.status),
  ],
);

export const bankFormatEnum = pgEnum("bank_format", [
  "leumi_pdf",
  "hapoalim_csv",
  "mizrahi_xlsx",
  "discount_csv",
  "ofx",
  "csv",
  "greeninvoice_csv",
]);

export const bankImportStatusEnum = pgEnum("bank_import_status", [
  "pending",
  "committed",
  "rejected",
]);

export type BankImportTxnJsonb = Array<Record<string, unknown>>;
export type BankImportErrorJsonb = Record<string, unknown>;

export const bankStatementImports = pgTable(
  "bank_statement_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    bank: text("bank").notNull(),
    sourceFormat: bankFormatEnum("source_format").notNull(),
    fileName: text("file_name"),
    fileBlobUrl: text("file_blob_url"),
    parsedTransactionsJsonb: jsonb("parsed_transactions_jsonb")
      .$type<BankImportTxnJsonb>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    rowCount: integer("row_count"),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
    status: bankImportStatusEnum("status").notNull().default("pending"),
    committedAt: timestamp("committed_at"),
    importedByUserId: uuid("imported_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    errorJsonb: jsonb("error_jsonb")
      .$type<BankImportErrorJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("bank_statement_imports_business_time_idx").on(
      table.businessId,
      table.importedAt,
    ),
  ],
);

export type BankReconciliationAdjustmentsJsonb = Record<string, unknown>;

export const bankReconciliations = pgTable(
  "bank_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    financialAccountId: uuid("financial_account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "cascade" }),
    statementPeriodStart: date("statement_period_start").notNull(),
    statementPeriodEnd: date("statement_period_end").notNull(),
    ledgerBalanceMinor: bigint("ledger_balance_minor", { mode: "bigint" }),
    statementBalanceMinor: bigint("statement_balance_minor", { mode: "bigint" }),
    adjustmentsJsonb: jsonb("adjustments_jsonb")
      .$type<BankReconciliationAdjustmentsJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    reconciledAt: timestamp("reconciled_at"),
    reconciledByUserId: uuid("reconciled_by_user_id").references(
      () => users.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("bank_reconciliations_business_period_idx").on(
      table.businessId,
      table.statementPeriodEnd,
    ),
  ],
);

export const processorEnum = pgEnum("processor", ["hyp", "grow", "payplus"]);

// Plan v4 rescope: processor sync pulls receipts (קבלות) and pairs them
// with our invoices, NOT pulls invoices. Default reflects the rescope.
export const processorSyncCredentials = pgTable(
  "processor_sync_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    processor: processorEnum("processor").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    syncedDocKind: text("synced_doc_kind").notNull().default("receipt"),
    lastSyncedAt: timestamp("last_synced_at"),
    syncCursor: text("sync_cursor"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("processor_sync_credentials_unique_active_idx")
      .on(table.businessId, table.processor)
      .where(sql`active = true`),
  ],
);

export const transactionsRelations = relations(transactions, ({ one }) => ({
  business: one(businesses, {
    fields: [transactions.businessId],
    references: [businesses.id],
  }),
  financialAccount: one(financialAccounts, {
    fields: [transactions.financialAccountId],
    references: [financialAccounts.id],
  }),
  linkedInvoice: one(invoices, {
    fields: [transactions.linkedInvoiceId],
    references: [invoices.id],
  }),
  linkedJournalEntry: one(journalEntries, {
    fields: [transactions.linkedJournalEntryId],
    references: [journalEntries.id],
  }),
}));

export const receiptsRelations = relations(receipts, ({ one }) => ({
  business: one(businesses, {
    fields: [receipts.businessId],
    references: [businesses.id],
  }),
  fileKey: one(dataEncryptionKeys, {
    fields: [receipts.fileKeyId],
    references: [dataEncryptionKeys.id],
  }),
}));

export const bankStatementImportsRelations = relations(
  bankStatementImports,
  ({ one }) => ({
    business: one(businesses, {
      fields: [bankStatementImports.businessId],
      references: [businesses.id],
    }),
    importedByUser: one(users, {
      fields: [bankStatementImports.importedByUserId],
      references: [users.id],
    }),
  }),
);

export const bankReconciliationsRelations = relations(
  bankReconciliations,
  ({ one }) => ({
    business: one(businesses, {
      fields: [bankReconciliations.businessId],
      references: [businesses.id],
    }),
    financialAccount: one(financialAccounts, {
      fields: [bankReconciliations.financialAccountId],
      references: [financialAccounts.id],
    }),
    reconciledByUser: one(users, {
      fields: [bankReconciliations.reconciledByUserId],
      references: [users.id],
    }),
  }),
);

export const processorSyncCredentialsRelations = relations(
  processorSyncCredentials,
  ({ one }) => ({
    business: one(businesses, {
      fields: [processorSyncCredentials.businessId],
      references: [businesses.id],
    }),
  }),
);
