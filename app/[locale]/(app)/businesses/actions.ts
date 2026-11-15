"use server";

import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { businesses } from "@/db/schema/businesses";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";

// IL entity classification + VAT status + bookkeeping enums. Mirror the
// pgEnum values in db/schema/businesses.ts.
const entityTypeEnum = z.enum([
  "patur",
  "morshe",
  "hevra_baam",
  "amuta",
  "shutfut",
]);
const vatStatusEnum = z.enum([
  "liable",
  "osek_patur",
  "osek_morshe",
  "exporter",
  "nonprofit",
]);
const bookkeepingMethodEnum = z.enum(["single_entry", "double_entry"]);

// Shared form schema for create + update. `id` is optional (update only).
const baseBusinessSchema = z.object({
  id: z.string().uuid().optional(),
  legalName: z.string().trim().min(1).max(255),
  vatId: z.string().trim().min(1).max(40),
  entityType: entityTypeEnum,
  vatStatus: vatStatusEnum,
  bookkeepingMethod: bookkeepingMethodEnum,
  taxYearEndMonth: z.coerce.number().int().min(1).max(12).default(12),
  advanceTaxRatePct: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? null : Number(v))),
  tikNikuyim: z.string().trim().max(40).optional().or(z.literal("")),
  defaultCurrency: z.string().trim().length(3).default("ILS"),
  addressStreet: z.string().trim().max(255).optional().or(z.literal("")),
  addressCity: z.string().trim().max(255).optional().or(z.literal("")),
  addressPostalCode: z.string().trim().max(40).optional().or(z.literal("")),
  addressCountry: z.string().trim().length(2).default("IL"),
  ilMunicipalAuthority: z.string().trim().max(120).optional().or(z.literal("")),
});

export type BusinessActionResult =
  | { ok: true; id: string }
  | { error: string }
  | { stepUpRequired: { op: string; payloadHash: string } };

function parseFormData(formData: FormData): unknown {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

function nullIfBlank(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export async function createBusiness(
  formData: FormData,
): Promise<BusinessActionResult> {
  const me = await requireCurrentUser();
  const parsed = baseBusinessSchema.safeParse(parseFormData(formData));
  if (!parsed.success) {
    return { error: "app.errors.invalidInput" };
  }
  const input = parsed.data;
  const today = new Date().toISOString().slice(0, 10);

  const id = await withUser(me.appUserId, async (tx) => {
    const inserted = (await tx.execute(
      sql`INSERT INTO businesses (
            owner_user_id, legal_name, vat_id, entity_type, vat_status,
            bookkeeping_method, tax_year_end_month, advance_tax_rate_pct,
            tik_nikuyim, default_currency,
            address_street, address_city, address_postal_code, address_country,
            il_municipal_authority
          ) VALUES (
            ${me.appUserId}::uuid, ${input.legalName}, ${input.vatId},
            ${input.entityType}::entity_type, ${input.vatStatus}::vat_status,
            ${input.bookkeepingMethod}::bookkeeping_method,
            ${input.taxYearEndMonth},
            ${input.advanceTaxRatePct},
            ${nullIfBlank(input.tikNikuyim ?? null)},
            ${input.defaultCurrency},
            ${nullIfBlank(input.addressStreet ?? null)},
            ${nullIfBlank(input.addressCity ?? null)},
            ${nullIfBlank(input.addressPostalCode ?? null)},
            ${input.addressCountry},
            ${nullIfBlank(input.ilMunicipalAuthority ?? null)}
          )
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const newId = inserted[0]?.id;
    if (!newId) throw new Error("createBusiness: insert returned no row");

    await tx.execute(
      sql`INSERT INTO business_vat_status_history (
            business_id, entity_type, vat_status, effective_from,
            reason, changed_by_user_id
          ) VALUES (
            ${newId}::uuid,
            ${input.entityType}::entity_type,
            ${input.vatStatus}::vat_status,
            ${today}::date,
            ${"initial"},
            ${me.appUserId}::uuid
          )`,
    );

    return newId;
  });

  revalidatePath("/businesses");
  revalidatePath("/dashboard");
  return { ok: true, id };
}

export async function updateBusiness(
  formData: FormData,
): Promise<BusinessActionResult> {
  const me = await requireCurrentUser();
  const parsed = baseBusinessSchema.safeParse(parseFormData(formData));
  if (!parsed.success || !parsed.data.id) {
    return { error: "app.errors.invalidInput" };
  }
  const input = parsed.data;
  const id = input.id!;
  const today = new Date().toISOString().slice(0, 10);

  // Council C-2: vat_status / entity_type transitions are tax-regime-
  // facing and must be gated by a fresh step-up proof. We read prior
  // state in a service-style probe (RLS-scoped via withUser later for
  // the write); a separate select keeps the step-up check off the
  // critical write path.
  let priorBeforeStepUp:
    | { entityType: string; vatStatus: string; defaultCurrency: string }
    | null = null;
  await withUser(me.appUserId, async (tx) => {
    const rows = (await tx
      .select({
        entityType: businesses.entityType,
        vatStatus: businesses.vatStatus,
        defaultCurrency: businesses.defaultCurrency,
      })
      .from(businesses)
      .where(and(eq(businesses.id, id), isNull(businesses.deletedAt)))
      .limit(1)) as Array<{
      entityType: string;
      vatStatus: string;
      defaultCurrency: string;
    }>;
    priorBeforeStepUp = rows[0] ?? null;
  });
  if (!priorBeforeStepUp) {
    return { error: "app.errors.invalidInput" };
  }
  const priorSnapshot: {
    entityType: string;
    vatStatus: string;
    defaultCurrency: string;
  } = priorBeforeStepUp;
  const vatStatusChanging =
    priorSnapshot.vatStatus !== input.vatStatus ||
    priorSnapshot.entityType !== input.entityType;
  if (vatStatusChanging) {
    try {
      await requireFreshSession({
        op: "business.update_vat_status",
        payloadHash: computePayloadHash({
          businessId: id,
          vatStatusBefore: priorSnapshot.vatStatus,
          vatStatusAfter: input.vatStatus,
          entityTypeBefore: priorSnapshot.entityType,
          entityTypeAfter: input.entityType,
        }),
      });
    } catch (err) {
      if (err instanceof StepUpRequired) {
        return {
          stepUpRequired: { op: err.op, payloadHash: err.payloadHash },
        };
      }
      throw err;
    }
  }
  // Default currency change is also tax-regime-facing: it affects how
  // every subsequent invoice + transaction is denominated. Council
  // step-up registry already lists `business.update_default_currency`.
  if (priorSnapshot.defaultCurrency !== input.defaultCurrency) {
    try {
      await requireFreshSession({
        op: "business.update_default_currency",
        payloadHash: computePayloadHash({
          businessId: id,
          before: priorSnapshot.defaultCurrency,
          after: input.defaultCurrency,
        }),
      });
    } catch (err) {
      if (err instanceof StepUpRequired) {
        return {
          stepUpRequired: { op: err.op, payloadHash: err.payloadHash },
        };
      }
      throw err;
    }
  }

  await withUser(me.appUserId, async (tx) => {
    const prior = (await tx
      .select({
        entityType: businesses.entityType,
        vatStatus: businesses.vatStatus,
      })
      .from(businesses)
      .where(and(eq(businesses.id, id), isNull(businesses.deletedAt)))
      .limit(1)) as Array<{ entityType: string; vatStatus: string }>;
    if (prior.length === 0) {
      throw new Error("updateBusiness: not found or no permission");
    }

    await tx.execute(
      sql`UPDATE businesses SET
            legal_name = ${input.legalName},
            vat_id = ${input.vatId},
            entity_type = ${input.entityType}::entity_type,
            vat_status = ${input.vatStatus}::vat_status,
            bookkeeping_method = ${input.bookkeepingMethod}::bookkeeping_method,
            tax_year_end_month = ${input.taxYearEndMonth},
            advance_tax_rate_pct = ${input.advanceTaxRatePct},
            tik_nikuyim = ${nullIfBlank(input.tikNikuyim ?? null)},
            default_currency = ${input.defaultCurrency},
            address_street = ${nullIfBlank(input.addressStreet ?? null)},
            address_city = ${nullIfBlank(input.addressCity ?? null)},
            address_postal_code = ${nullIfBlank(input.addressPostalCode ?? null)},
            address_country = ${input.addressCountry},
            il_municipal_authority = ${nullIfBlank(input.ilMunicipalAuthority ?? null)}
          WHERE id = ${id}::uuid`,
    );

    const before = prior[0]!;
    const statusChanged =
      before.entityType !== input.entityType ||
      before.vatStatus !== input.vatStatus;
    if (statusChanged) {
      await tx.execute(
        sql`UPDATE business_vat_status_history
            SET effective_to = ${today}::date
            WHERE business_id = ${id}::uuid AND effective_to IS NULL`,
      );
      await tx.execute(
        sql`INSERT INTO business_vat_status_history (
              business_id, entity_type, vat_status, effective_from,
              reason, changed_by_user_id
            ) VALUES (
              ${id}::uuid,
              ${input.entityType}::entity_type,
              ${input.vatStatus}::vat_status,
              ${today}::date,
              ${"manual_update"},
              ${me.appUserId}::uuid
            )`,
      );
    }
  });

  revalidatePath("/businesses");
  revalidatePath(`/businesses/${id}`);
  revalidatePath("/dashboard");
  return { ok: true, id };
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteBusiness(
  formData: FormData,
): Promise<BusinessActionResult | void> {
  const me = await requireCurrentUser();
  const parsed = deleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { id } = parsed.data;

  try {
    await requireFreshSession({
      op: "business.delete",
      payloadHash: computePayloadHash({ businessId: id }),
    });
  } catch (err) {
    if (err instanceof StepUpRequired) {
      return { stepUpRequired: { op: err.op, payloadHash: err.payloadHash } };
    }
    throw err;
  }

  await withUser(me.appUserId, async (tx) => {
    await tx
      .update(businesses)
      .set({ deletedAt: new Date() })
      .where(and(eq(businesses.id, id), isNull(businesses.deletedAt)));
  });

  revalidatePath("/businesses");
  revalidatePath("/dashboard");
  redirect({ href: "/businesses", locale: await getLocale() });
}
