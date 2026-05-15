import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  integer,
  bigint,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

export const billingIntervalEnum = pgEnum("billing_interval", [
  "month",
  "year",
]);

export const subscriptionProviderEnum = pgEnum("subscription_provider", [
  "mock",
  "stripe",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "cancelled",
  "expired",
]);

// Stable plan identifiers — seeded by 0003 migration. Free / Solo ₪49 /
// Plus ₪99 / Business ₪199 / Accountant ₪399. Use text PK so app code can
// reference by symbolic name; price stored in minor units (agorot).
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
  currency: text("currency").notNull().default("ILS"),
  billingInterval: billingIntervalEnum("billing_interval")
    .notNull()
    .default("month"),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Key/value entitlements. value_int OR value_bool — never both. Keys are
// app-defined symbolic names (e.g. "businesses.max", "ai.messages_per_month",
// "filings.pcn874", "processor_sync.enabled"). Composite PK by (plan_id, key)
// so an UPSERT can update an entitlement without growing the table.
export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueInt: integer("value_int"),
    valueBool: boolean("value_bool"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.planId, table.key] })],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    provider: subscriptionProviderEnum("provider").notNull().default("mock"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    status: subscriptionStatusEnum("status").notNull().default("trialing"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("subscriptions_user_idx").on(table.userId),
    uniqueIndex("subscriptions_provider_sub_idx")
      .on(table.providerSubscriptionId)
      .where(sql`provider_subscription_id IS NOT NULL`),
  ],
);

export const plansRelations = relations(plans, ({ many }) => ({
  entitlements: many(planEntitlements),
  subscriptions: many(subscriptions),
}));

export const planEntitlementsRelations = relations(
  planEntitlements,
  ({ one }) => ({
    plan: one(plans, {
      fields: [planEntitlements.planId],
      references: [plans.id],
    }),
  }),
);

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
  plan: one(plans, {
    fields: [subscriptions.planId],
    references: [plans.id],
  }),
}));
