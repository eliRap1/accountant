// Onboarding defaults per entity_type.
//
// Council Q5 decision: drop the auto-detect-from-VAT-ID heuristic and
// the vat_status / bookkeeping_method pickers. Instead, derive both
// values deterministically from the 3 cards the user picks
// (patur / morshe / hevra_baam).
//
// The user can still change either value later from /settings — but
// the 95% of עצמאים who self-classify "I'm a freelancer / I run a
// company" never have to think about VAT-status sub-types.

import type { VatStatus } from "@/lib/tax/il/types";

export type EntityType = "patur" | "morshe" | "hevra_baam";
export type BookkeepingMethod = "single_entry" | "double_entry";

export type EntityDefaults = {
  vatStatus: VatStatus;
  bookkeepingMethod: BookkeepingMethod;
  taxYearEndMonth: 12;
  defaultCurrency: "ILS";
  addressCountry: "IL";
};

/**
 * Map a chosen `entity_type` to the (vat_status, bookkeeping_method)
 * tuple every new business is born with. The values follow council Q5:
 *
 *   - patur       → osek_patur,  single_entry
 *   - morshe      → osek_morshe, single_entry
 *   - hevra_baam  → osek_morshe, double_entry
 *
 * `tax_year_end_month`, `default_currency`, `address_country` are
 * non-negotiable IL defaults (December year-end, ILS, Israel).
 */
export function defaultsFor(entityType: EntityType): EntityDefaults {
  switch (entityType) {
    case "patur":
      return {
        vatStatus: "osek_patur",
        bookkeepingMethod: "single_entry",
        taxYearEndMonth: 12,
        defaultCurrency: "ILS",
        addressCountry: "IL",
      };
    case "morshe":
      return {
        vatStatus: "osek_morshe",
        bookkeepingMethod: "single_entry",
        taxYearEndMonth: 12,
        defaultCurrency: "ILS",
        addressCountry: "IL",
      };
    case "hevra_baam":
      return {
        vatStatus: "osek_morshe",
        bookkeepingMethod: "double_entry",
        taxYearEndMonth: 12,
        defaultCurrency: "ILS",
        addressCountry: "IL",
      };
  }
}
