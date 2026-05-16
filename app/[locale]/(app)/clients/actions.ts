"use server";

import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { clients } from "@/db/schema/clients";
import { encryptStringWithKey } from "@/lib/security/encryption";
import { getKek } from "@/lib/security/kek";

// Encrypted fields use AAD {table:'clients', column:'<col>', rowId: id}.
// The id is only known *after* INSERT, so the action does insert-with-NULL
// → encrypt → UPDATE. This is consistent with the documented envelope-
// encryption pattern: the AAD is bound to the row identity.

// Encrypted PII fields (email/phone/notes) accept three states from the
// form:
//   1. omitted / empty / whitespace   → preserve existing ciphertext
//   2. explicit `__clear__` sentinel  → write NULL (user-initiated wipe)
//   3. non-empty value                → encrypt + overwrite
//
// Without this distinction the form would silently drop PII the moment a
// user edits the legal_name field without re-typing their email (council
// finding C-6). The `__clear__` sentinel is unguessable enough to not
// collide with a real value but readable for tests and for accountants
// debugging form-state issues.
import { CLIENT_PII_CLEAR_SENTINEL, type ClientActionResult } from "./types";

const baseClientSchema = z.object({
  id: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  legalName: z.string().trim().min(1).max(255),
  vatId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal("")),
  // For PII fields, do NOT auto-trim. We need to distinguish a truly
  // empty submission (preserve) from a non-empty value (write). Trimming
  // happens later inside resolvePiiFieldUpdate.
  email: z.string().max(255).optional(),
  phone: z.string().max(60).optional(),
  notes: z.string().max(4000).optional(),
  addressStreet: z.string().trim().max(255).optional().or(z.literal("")),
  addressCity: z.string().trim().max(255).optional().or(z.literal("")),
  addressPostalCode: z.string().trim().max(40).optional().or(z.literal("")),
  addressCountry: z.string().trim().max(4).optional().or(z.literal("")),
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365).default(14),
  defaultCurrency: z.string().trim().length(3).default("ILS"),
});

type PiiFieldUpdate =
  | { kind: "preserve" }
  | { kind: "clear" }
  | { kind: "write"; ciphertext: string };

function resolvePiiFieldUpdate(
  raw: string | undefined,
  rowId: string,
  column: string,
): PiiFieldUpdate {
  if (raw === undefined || raw === null) return { kind: "preserve" };
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "preserve" };
  if (trimmed === CLIENT_PII_CLEAR_SENTINEL) return { kind: "clear" };
  return {
    kind: "write",
    ciphertext: encryptStringWithKey({
      key: getKek(),
      plaintext: trimmed,
      aad: { table: "clients", column, rowId },
    }),
  };
}

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

function encryptOrNull(
  plaintext: string | null | undefined,
  rowId: string,
  column: string,
): string | null {
  const t = nullIfBlank(plaintext);
  if (!t) return null;
  return encryptStringWithKey({
    key: getKek(),
    plaintext: t,
    aad: { table: "clients", column, rowId },
  });
}

export async function createClient(
  formData: FormData,
): Promise<ClientActionResult> {
  const me = await requireCurrentUser();
  const parsed = baseClientSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const input = parsed.data;

  const id = await withUser(me.appUserId, async (tx) => {
    // RLS guarantees businessId belongs to the current user: an INSERT
    // that references another business will fail at the policy layer.
    const inserted = (await tx.execute(
      sql`INSERT INTO clients (
            business_id, legal_name, vat_id,
            address_street, address_city, address_postal_code, address_country,
            default_payment_terms_days, default_currency
          ) VALUES (
            ${input.businessId}::uuid,
            ${input.legalName},
            ${nullIfBlank(input.vatId ?? null)},
            ${nullIfBlank(input.addressStreet ?? null)},
            ${nullIfBlank(input.addressCity ?? null)},
            ${nullIfBlank(input.addressPostalCode ?? null)},
            ${nullIfBlank(input.addressCountry ?? null) ?? "IL"},
            ${input.defaultPaymentTermsDays},
            ${input.defaultCurrency}
          )
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const newId = inserted[0]?.id;
    if (!newId) throw new Error("createClient: insert returned no row");

    // Now we have the row id — encrypt with AAD-bound ciphertexts and
    // patch them back onto the row in the same transaction.
    const emailCt = encryptOrNull(input.email, newId, "email_ciphertext");
    const phoneCt = encryptOrNull(input.phone, newId, "phone_ciphertext");
    const notesCt = encryptOrNull(input.notes, newId, "notes_ciphertext");

    if (emailCt || phoneCt || notesCt) {
      await tx.execute(
        sql`UPDATE clients
            SET email_ciphertext = ${emailCt},
                phone_ciphertext = ${phoneCt},
                notes_ciphertext = ${notesCt}
            WHERE id = ${newId}::uuid`,
      );
    }
    return newId;
  });

  revalidatePath("/clients");
  return { ok: true, id };
}

export async function updateClient(
  formData: FormData,
): Promise<ClientActionResult> {
  const me = await requireCurrentUser();
  const parsed = baseClientSchema.safeParse(parseFormData(formData));
  if (!parsed.success || !parsed.data.id) {
    return { error: "app.errors.invalidInput" };
  }
  const input = parsed.data;
  const id = input.id!;

  // Resolve each encrypted PII field into preserve / clear / write so a
  // blank submit does NOT silently drop existing ciphertext (council
  // C-6). Each field is independent; the user can clear email while
  // preserving phone.
  const emailUpdate = resolvePiiFieldUpdate(input.email, id, "email_ciphertext");
  const phoneUpdate = resolvePiiFieldUpdate(input.phone, id, "phone_ciphertext");
  const notesUpdate = resolvePiiFieldUpdate(input.notes, id, "notes_ciphertext");

  await withUser(me.appUserId, async (tx) => {
    // Always update the non-encrypted columns. PII columns are written
    // conditionally — three SQL statements (one per field that is NOT
    // preserve) keeps the SQL trivial vs a giant CASE-WHEN. The whole
    // thing runs in a single transaction (withUser), so partial
    // failure rolls back as a unit.
    await tx.execute(
      sql`UPDATE clients SET
            business_id = ${input.businessId}::uuid,
            legal_name = ${input.legalName},
            vat_id = ${nullIfBlank(input.vatId ?? null)},
            address_street = ${nullIfBlank(input.addressStreet ?? null)},
            address_city = ${nullIfBlank(input.addressCity ?? null)},
            address_postal_code = ${nullIfBlank(input.addressPostalCode ?? null)},
            address_country = ${nullIfBlank(input.addressCountry ?? null) ?? "IL"},
            default_payment_terms_days = ${input.defaultPaymentTermsDays},
            default_currency = ${input.defaultCurrency}
          WHERE id = ${id}::uuid AND deleted_at IS NULL`,
    );

    if (emailUpdate.kind === "write") {
      await tx.execute(
        sql`UPDATE clients SET email_ciphertext = ${emailUpdate.ciphertext}
            WHERE id = ${id}::uuid AND deleted_at IS NULL`,
      );
    } else if (emailUpdate.kind === "clear") {
      await tx.execute(
        sql`UPDATE clients SET email_ciphertext = NULL
            WHERE id = ${id}::uuid AND deleted_at IS NULL`,
      );
    }
    if (phoneUpdate.kind === "write") {
      await tx.execute(
        sql`UPDATE clients SET phone_ciphertext = ${phoneUpdate.ciphertext}
            WHERE id = ${id}::uuid AND deleted_at IS NULL`,
      );
    } else if (phoneUpdate.kind === "clear") {
      await tx.execute(
        sql`UPDATE clients SET phone_ciphertext = NULL
            WHERE id = ${id}::uuid AND deleted_at IS NULL`,
      );
    }
    if (notesUpdate.kind === "write") {
      await tx.execute(
        sql`UPDATE clients SET notes_ciphertext = ${notesUpdate.ciphertext}
            WHERE id = ${id}::uuid AND deleted_at IS NULL`,
      );
    } else if (notesUpdate.kind === "clear") {
      await tx.execute(
        sql`UPDATE clients SET notes_ciphertext = NULL
            WHERE id = ${id}::uuid AND deleted_at IS NULL`,
      );
    }
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { ok: true, id };
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function softDeleteClient(
  formData: FormData,
): Promise<ClientActionResult | void> {
  const me = await requireCurrentUser();
  const parsed = deleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { id } = parsed.data;

  await withUser(me.appUserId, async (tx) => {
    await tx
      .update(clients)
      .set({ deletedAt: new Date() })
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)));
  });

  revalidatePath("/clients");
  redirect({ href: "/clients", locale: await getLocale() });
}
