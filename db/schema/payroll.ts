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
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { businesses } from "./businesses";
import { dataEncryptionKeys } from "./ops";

// Identification document kind for the employee. Israeli citizens use
// teudat zehut; foreign workers carry a separately-issued ID. Both are
// stored ciphered (never plaintext) — AAD = {table:'payroll_employees',
// column:'national_id_ciphertext', rowId:<employee_id>}.
export const nationalIdKindEnum = pgEnum("national_id_kind", [
  "teudat_zehut",
  "foreign_worker_id",
]);

// Bituach Leumi (NII) employee classification. Drives the Form 102
// computation and the per-employee monthly contribution table.
// `<verify-this-with-CPA>` — exact class set should be re-validated
// against btl.gov.il/Insurance/Insurance_rates before Form 102 ships.
export const bituachLeumiClassEnum = pgEnum("bituach_leumi_class", [
  "employee_regular",
  "employee_under_18",
  "employee_over_retirement",
  "controlling_shareholder",
  "kibbutz_member",
  "foreign_worker",
  "student",
  "other",
]);

export type Form101DeclarationDataCiphertext = string;

// Employee roster. PII (legal_name, national_id, gross monthly) is encrypted
// per-row under a DEK referenced via `dek_id`. The Form 101 declaration is
// stored separately so its decryption pathway can be audited independently.
export const payrollEmployees = pgTable(
  "payroll_employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    legalNameCiphertext: text("legal_name_ciphertext"),
    nationalIdCiphertext: text("national_id_ciphertext"),
    nationalIdKind: nationalIdKindEnum("national_id_kind").notNull(),
    grossMonthlyMinorCiphertext: text("gross_monthly_minor_ciphertext"),
    // נקודות זיכוי — credit points count, up to ~3 decimal precision
    // (e.g. 2.25 for a parent with a young child). Stored plaintext as it
    // is not PII on its own.
    creditPointsCount: numeric("credit_points_count", {
      precision: 3,
      scale: 1,
    }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    bituachLeumiClass: bituachLeumiClassEnum("bituach_leumi_class").notNull(),
    // Misc metadata from the employee's tax certificate (טופס 101 הצהרת
    // עובד) — kept as JSONB to absorb regulator-driven schema drift
    // without a migration.
    taxCertificateMetadataJsonb: jsonb("tax_certificate_metadata_jsonb")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    dekId: uuid("dek_id").references(() => dataEncryptionKeys.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("payroll_employees_business_idx").on(table.businessId),
  ],
);

// Per-period payroll closure. Totals + per-employee breakdown both stored
// as ciphertext under the same DEK. Form 102 prep JSONB is plaintext —
// it carries aggregate numbers needed for the report's header rows
// (employee count, BL employer share total, etc.) without per-employee
// PII so a downstream generator can render it without unwrapping the DEK.
export type Form102PrepJsonb = {
  employeeCount?: number;
  totalGrossMinor?: number;
  totalEmployerNiiMinor?: number;
  totalEmployeeNiiMinor?: number;
  totalIncomeTaxWithheldMinor?: number;
  meta?: Record<string, unknown>;
};

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // Human-friendly period label, e.g. "2026-01" for January 2026. The
    // canonical period is the (period_start, period_end) pair.
    periodLabel: text("period_label").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    totalsCiphertext: text("totals_ciphertext"),
    breakdownCiphertext: text("breakdown_ciphertext"),
    form102PrepJsonb: jsonb("form_102_prep_jsonb")
      .$type<Form102PrepJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    dekId: uuid("dek_id").references(() => dataEncryptionKeys.id, {
      onDelete: "restrict",
    }),
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("payroll_runs_business_period_idx").on(
      table.businessId,
      table.periodEnd,
    ),
  ],
);

// Annual employee tax declaration (טופס 101). 7-year retention per IL
// Income Tax Ordinance § 130. The full declaration payload is stored as
// ciphertext under the employee's DEK — even the fiscal year is the only
// plaintext index column so we can find rows for an audit without
// unwrapping the DEK.
export const form101Declarations = pgTable(
  "form_101_declarations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollEmployeeId: uuid("payroll_employee_id")
      .notNull()
      .references(() => payrollEmployees.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    declarationDataCiphertext: text("declaration_data_ciphertext"),
    dekId: uuid("dek_id").references(() => dataEncryptionKeys.id, {
      onDelete: "restrict",
    }),
    submittedAt: timestamp("submitted_at"),
    submittedAsmachta: text("submitted_asmachta"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("form_101_declarations_employee_year_idx").on(
      table.payrollEmployeeId,
      table.fiscalYear,
    ),
  ],
);

// Per-employee pension contribution row for the period. Used by the
// pension provider integration and by the annual Form 126 generator.
export const pensionContributions = pgTable(
  "pension_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    payrollEmployeeId: uuid("payroll_employee_id")
      .notNull()
      .references(() => payrollEmployees.id, { onDelete: "cascade" }),
    employeeContributionMinor: bigint("employee_contribution_minor", {
      mode: "bigint",
    }).notNull(),
    employerContributionMinor: bigint("employer_contribution_minor", {
      mode: "bigint",
    }).notNull(),
    providerName: text("provider_name"),
    providerAccountRef: text("provider_account_ref"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("pension_contributions_run_idx").on(table.payrollRunId),
    index("pension_contributions_employee_idx").on(table.payrollEmployeeId),
  ],
);

// פיצויי פיטורין — severance accrual + payouts. Accrued amounts roll over
// across periods; paid_at + paid_amount_minor freeze the payout when
// severance is settled.
export const severanceProvisions = pgTable(
  "severance_provisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    payrollEmployeeId: uuid("payroll_employee_id")
      .notNull()
      .references(() => payrollEmployees.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    accruedMinor: bigint("accrued_minor", { mode: "bigint" }).notNull(),
    paidAt: timestamp("paid_at"),
    paidAmountMinor: bigint("paid_amount_minor", { mode: "bigint" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("severance_provisions_business_idx").on(table.businessId),
    index("severance_provisions_employee_idx").on(table.payrollEmployeeId),
  ],
);

export const payrollEmployeesRelations = relations(
  payrollEmployees,
  ({ one, many }) => ({
    business: one(businesses, {
      fields: [payrollEmployees.businessId],
      references: [businesses.id],
    }),
    dek: one(dataEncryptionKeys, {
      fields: [payrollEmployees.dekId],
      references: [dataEncryptionKeys.id],
    }),
    form101Declarations: many(form101Declarations),
    pensionContributions: many(pensionContributions),
    severanceProvisions: many(severanceProvisions),
  }),
);

export const payrollRunsRelations = relations(payrollRuns, ({ one, many }) => ({
  business: one(businesses, {
    fields: [payrollRuns.businessId],
    references: [businesses.id],
  }),
  dek: one(dataEncryptionKeys, {
    fields: [payrollRuns.dekId],
    references: [dataEncryptionKeys.id],
  }),
  pensionContributions: many(pensionContributions),
}));

export const form101DeclarationsRelations = relations(
  form101Declarations,
  ({ one }) => ({
    employee: one(payrollEmployees, {
      fields: [form101Declarations.payrollEmployeeId],
      references: [payrollEmployees.id],
    }),
    dek: one(dataEncryptionKeys, {
      fields: [form101Declarations.dekId],
      references: [dataEncryptionKeys.id],
    }),
  }),
);

export const pensionContributionsRelations = relations(
  pensionContributions,
  ({ one }) => ({
    payrollRun: one(payrollRuns, {
      fields: [pensionContributions.payrollRunId],
      references: [payrollRuns.id],
    }),
    employee: one(payrollEmployees, {
      fields: [pensionContributions.payrollEmployeeId],
      references: [payrollEmployees.id],
    }),
  }),
);

export const severanceProvisionsRelations = relations(
  severanceProvisions,
  ({ one }) => ({
    business: one(businesses, {
      fields: [severanceProvisions.businessId],
      references: [businesses.id],
    }),
    employee: one(payrollEmployees, {
      fields: [severanceProvisions.payrollEmployeeId],
      references: [payrollEmployees.id],
    }),
  }),
);
