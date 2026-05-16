// Schema Layer 3 — recurring + reminders.
//
// The two tables (`recurring_invoice_templates`, `invoice_reminders`) that
// the v5 architecture memo lists under Layer 3 already live in
// `db/schema/invoicing.ts` (Layer 2), because they were shipped together
// with the invoices schema in migration 0004 + RLS in 0005. Re-creating
// them here would produce duplicate Drizzle exports and break `db/schema/
// index.ts`.
//
// This file therefore re-exports the two tables from their physical home
// so a future reader navigating Layer-3 mental-model imports finds them
// at the expected path. The cohesion is documentary only — the canonical
// definitions remain in `invoicing.ts`.
//
// RLS for these two tables is already enabled by migration
// `0005_rls_layer2.sql` (see policies `recurring_invoice_templates_*` and
// `invoice_reminders_*` therein). Layer 3 RLS (`0008_rls_layer3.sql`)
// therefore does NOT redeclare policies for them.

export {
  recurringInvoiceTemplates,
  recurringInvoiceTemplatesRelations,
  invoiceReminders,
  invoiceRemindersRelations,
  type RecurringInvoiceTemplateJsonb,
} from "./invoicing";
