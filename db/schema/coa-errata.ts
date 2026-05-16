import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { businesses } from "./businesses";

// Dismissable banner state for one-time announcements that the seeded
// chart-of-accounts has been corrected by a CPA-council errata.
//
// Per docs/council/2026-05-16-architecture-v5-council-answers.md Q4:
//   - One row per (business_id, errata_version), inserted at migration time
//     by 0010_coa_errata_notices.sql backfill.
//   - Owners dismiss; engaged accountants can read but cannot dismiss
//     (enforced by RLS: SELECT via app_user_can_access_business,
//     UPDATE/DELETE via app_user_owns_business).
//   - No INSERT policy ⇒ application code cannot insert; backfills are
//     written under the service role.
//
// notes_jsonb shape (free-form for forward compatibility):
//   {
//     reclassified?: string[],
//     dropped_or_deactivated?: string[],
//     split?: string[],
//     renumbered?: string[],
//     added?: string[],
//     source_doc?: string,
//   }
export type CoaErrataNotesJsonb = {
  reclassified?: string[];
  dropped_or_deactivated?: string[];
  split?: string[];
  renumbered?: string[];
  added?: string[];
  source_doc?: string;
  meta?: Record<string, unknown>;
};

export const coaErrataNotices = pgTable(
  "coa_errata_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    errataVersion: text("errata_version").notNull(),
    introducedAt: timestamp("introduced_at").defaultNow().notNull(),
    dismissedAt: timestamp("dismissed_at"),
    dismissedByUserId: uuid("dismissed_by_user_id").references(
      () => users.id,
    ),
    affectedCodes: text("affected_codes").array().notNull(),
    notesJsonb: jsonb("notes_jsonb")
      .$type<CoaErrataNotesJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // One active (un-dismissed) notice per (business, version).
    uniqueIndex("coa_errata_notices_business_version_active_idx")
      .on(table.businessId, table.errataVersion)
      .where(sql`dismissed_at IS NULL`),
    // Banner lookup: list active notices for a business.
    index("coa_errata_notices_business_idx")
      .on(table.businessId)
      .where(sql`dismissed_at IS NULL`),
  ],
);

export const coaErrataNoticesRelations = relations(
  coaErrataNotices,
  ({ one }) => ({
    business: one(businesses, {
      fields: [coaErrataNotices.businessId],
      references: [businesses.id],
    }),
    dismissedByUser: one(users, {
      fields: [coaErrataNotices.dismissedByUserId],
      references: [users.id],
    }),
  }),
);
