import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// User-visible businesses, both owned and engaged.
//
// Council Q6: when a user has 0 businesses (owned + engaged), the (app)
// layout redirects to /onboarding. The header BusinessSwitcher consumes
// the SAME result; if the array is empty, it renders a static "no
// business" label and never opens.
//
// `bookkeepingMethod` is included so the AppShell can server-side gate
// the "Ledger" sidebar item: shown only when the active business uses
// double-entry (Product council § 4 IA rule).

export type UserBusiness = {
  id: string;
  legalName: string;
  kind: "owned" | "engaged";
  bookkeepingMethod: "single_entry" | "double_entry";
  vatStatus: string;
  entityType: string;
};

type OwnedRow = {
  id: string;
  legal_name: string;
  bookkeeping_method: "single_entry" | "double_entry";
  vat_status: string;
  entity_type: string;
};

type EngagedRow = OwnedRow;

export type UserBusinessContext = {
  /** Businesses owned outright by this user (canonical owner). */
  owned: UserBusiness[];
  /** Businesses this user is engaged on (accountant role, accepted, not revoked). */
  engaged: UserBusiness[];
  /** Convenience: owned ++ engaged in display order. */
  all: UserBusiness[];
};

export async function getUserBusinesses(
  userId: string,
): Promise<UserBusinessContext> {
  try {
    return await withUser(userId, async (tx) => {
      const ownedRows = (await tx.execute(
        sql`SELECT id::text, legal_name,
                   bookkeeping_method::text AS bookkeeping_method,
                   vat_status::text AS vat_status,
                   entity_type::text AS entity_type
            FROM businesses
            WHERE deleted_at IS NULL
            ORDER BY created_at ASC`,
      )) as unknown as OwnedRow[];

      const owned: UserBusiness[] = ownedRows.map((r) => ({
        id: r.id,
        legalName: r.legal_name,
        kind: "owned" as const,
        bookkeepingMethod: r.bookkeeping_method,
        vatStatus: r.vat_status,
        entityType: r.entity_type,
      }));

      // Engaged: ONLY rows the engagement RLS lets us see — accepted &
      // not revoked. The accountant_engagements table has its own RLS;
      // we still LEFT JOIN under withUser so the policy enforces visibility.
      const engagedRows = (await tx.execute(
        sql`SELECT b.id::text, b.legal_name,
                   b.bookkeeping_method::text AS bookkeeping_method,
                   b.vat_status::text AS vat_status,
                   b.entity_type::text AS entity_type
            FROM businesses b
            JOIN accountant_engagements e ON e.business_id = b.id
            WHERE b.deleted_at IS NULL
              AND e.accepted_at IS NOT NULL
              AND e.revoked_at IS NULL
              AND b.owner_user_id <> ${userId}::uuid
            ORDER BY b.created_at ASC`,
      )) as unknown as EngagedRow[];

      const engaged: UserBusiness[] = engagedRows.map((r) => ({
        id: r.id,
        legalName: r.legal_name,
        kind: "engaged" as const,
        bookkeepingMethod: r.bookkeeping_method,
        vatStatus: r.vat_status,
        entityType: r.entity_type,
      }));

      return { owned, engaged, all: [...owned, ...engaged] };
    });
  } catch {
    return { owned: [], engaged: [], all: [] };
  }
}
