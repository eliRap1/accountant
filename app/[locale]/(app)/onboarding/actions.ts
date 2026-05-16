"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { businesses, businessVatStatusHistory } from "@/db/schema/businesses";
import { withUser } from "@/lib/db/withUser";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { defaultsFor } from "@/lib/onboarding/defaults";

// Server Action result contract. `error` is a single human-readable
// message; the form layer maps zod errors to translated copy. We don't
// surface field-level errors per-key because the wizard is short
// enough that one banner is clearer than per-field markers.
export type CreateBusinessResult =
  | { ok: true; businessId: string }
  | { ok: false; error: string };

// Council Q5: drop the picker-driven vat_status + bookkeeping_method;
// the user only chooses entity_type (patur / morshe / hevra_baam). We
// still accept the legacy values from settings later, but the
// onboarding form only sends these three.
const entityTypeValues = ["patur", "morshe", "hevra_baam"] as const;

const schema = z.object({
  legalName: z.string().trim().min(1, "legalName"),
  // IL business ID: digits only, 8-9 chars (ע.מ. is 9; older ת.ז.-based
  // entries are 8). Checksum validation lands with Phase C
  // lib/invoices/ilValidate.ts; we accept length+digits for now.
  vatId: z
    .string()
    .trim()
    .min(8, "vatId")
    .max(9, "vatId")
    .regex(/^\d+$/, "vatId"),
  entityType: z.enum(entityTypeValues),
  addressCity: z.string().trim().optional().default(""),
});

export async function createBusinessAction(
  formData: FormData,
): Promise<CreateBusinessResult> {
  const user = await requireCurrentUser();

  const parsed = schema.safeParse({
    legalName: formData.get("legalName"),
    vatId: formData.get("vatId"),
    entityType: formData.get("entityType"),
    addressCity: formData.get("addressCity") ?? undefined,
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first?.message ?? "errors.required",
    };
  }
  const data = parsed.data;
  const derived = defaultsFor(data.entityType);

  try {
    const businessId = await withUser(user.appUserId, async (tx) => {
      const inserted = await tx
        .insert(businesses)
        .values({
          ownerUserId: user.appUserId,
          legalName: data.legalName,
          vatId: data.vatId,
          entityType: data.entityType,
          // Derived from entity_type per council Q5 — user never picks
          // these in the onboarding form.
          vatStatus: derived.vatStatus,
          bookkeepingMethod: derived.bookkeepingMethod,
          taxYearEndMonth: derived.taxYearEndMonth,
          defaultCurrency: derived.defaultCurrency,
          addressCountry: derived.addressCountry,
          ...(data.addressCity ? { addressCity: data.addressCity } : {}),
        })
        .returning({ id: businesses.id });

      const row = inserted[0];
      if (!row) {
        throw new Error("INSERT_FAILED");
      }

      // Snapshot the initial vat_status/entity_type pair into the
      // append-only history table. Same transaction so the business
      // row can't exist without an opening status snapshot.
      await tx.insert(businessVatStatusHistory).values({
        businessId: row.id,
        entityType: data.entityType,
        vatStatus: derived.vatStatus,
        // Use a SQL CURRENT_DATE expression so the value is generated
        // server-side at COMMIT — keeps the snapshot consistent with
        // the business row's createdAt without smuggling client time.
        effectiveFrom: sql`CURRENT_DATE`,
        changedByUserId: user.appUserId,
        reason: "onboarding",
      });

      return row.id;
    });

    revalidatePath("/onboarding");
    revalidatePath("/dashboard");
    return { ok: true, businessId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}
