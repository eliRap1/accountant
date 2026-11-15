import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { businesses } from "./businesses";

// Engagement role grants a non-owner user (an accountant or read-only viewer)
// scoped access to a business. Canonical immutable owner lives on
// businesses.owner_user_id; "owner" here is reserved for future co-ownership /
// ownership-transfer flows.
export const engagementRoleEnum = pgEnum("engagement_role", [
  "owner",
  "accountant",
  "viewer",
]);

export type EngagementScopesJsonb = {
  invoices?: boolean;
  filings?: boolean;
  payroll?: boolean;
  ledger?: boolean;
  ai?: boolean;
};

export const accountantEngagements = pgTable(
  "accountant_engagements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    accountantUserId: uuid("accountant_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: engagementRoleEnum("role").notNull().default("accountant"),
    scopesJsonb: jsonb("scopes_jsonb")
      .$type<EngagementScopesJsonb>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    invitedAt: timestamp("invited_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("accountant_engagements_business_idx").on(table.businessId),
    index("accountant_engagements_user_idx").on(table.accountantUserId),
    uniqueIndex("accountant_engagements_unique_active_idx")
      .on(table.businessId, table.accountantUserId)
      .where(sql`revoked_at IS NULL`),
  ],
);

export const accountantEngagementsRelations = relations(
  accountantEngagements,
  ({ one }) => ({
    business: one(businesses, {
      fields: [accountantEngagements.businessId],
      references: [businesses.id],
    }),
    accountantUser: one(users, {
      fields: [accountantEngagements.accountantUserId],
      references: [users.id],
    }),
  }),
);
