"use server";

import { z } from "zod";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";

const directionEnum = z.enum(["income", "expense", "transfer"]);

const baseTxnSchema = z.object({
  id: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  financialAccountId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? null : v)),
  direction: directionEnum,
  // Major-unit amount input from the form; we convert to minor for storage.
  amountMajor: z.coerce.number().positive().max(1_000_000_000),
  currency: z.string().trim().length(3).default("ILS"),
  categoryCode: z.string().trim().max(20).optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  txnDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type TransactionActionResult =
  | { ok: true; id: string }
  | { error: string };

function parseFormData(formData: FormData): unknown {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

function toMinor(major: number, currency: string): bigint {
  // ILS, USD, EUR, GBP all use 2 decimal places. Future: switch on
  // currency exponent (JPY = 0, BHD = 3, etc.). For now Phase B is
  // ILS-first and the form only allows positive numbers.
  void currency;
  return BigInt(Math.round(major * 100));
}

function nullIfBlank(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Inline "+ New account" path on the transaction form. Returns the new id.
const newAccountSchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  kind: z
    .enum(["bank", "cash", "credit_card", "loan", "equity", "other"])
    .default("other"),
  currency: z.string().trim().length(3).default("ILS"),
});

export async function createFinancialAccount(
  formData: FormData,
): Promise<{ ok: true; id: string; name: string } | { error: string }> {
  const me = await requireCurrentUser();
  const parsed = newAccountSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const input = parsed.data;
  const result = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO financial_accounts (business_id, kind, name, currency)
          VALUES (${input.businessId}::uuid,
                  ${input.kind}::financial_account_kind,
                  ${input.name},
                  ${input.currency})
          RETURNING id, name`,
    )) as unknown as Array<{ id: string; name: string }>;
    return rows[0];
  });
  if (!result) return { error: "app.errors.invalidInput" };
  revalidatePath("/transactions");
  return { ok: true, id: result.id, name: result.name };
}

export async function createTransaction(
  formData: FormData,
): Promise<TransactionActionResult> {
  const me = await requireCurrentUser();
  const parsed = baseTxnSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const input = parsed.data;

  const id = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO transactions (
            business_id, financial_account_id, direction,
            category_code, amount_minor, currency, description,
            txn_date, source
          ) VALUES (
            ${input.businessId}::uuid,
            ${input.financialAccountId}::uuid,
            ${input.direction}::transaction_direction,
            ${nullIfBlank(input.categoryCode ?? null)},
            ${toMinor(input.amountMajor, input.currency)}::bigint,
            ${input.currency},
            ${nullIfBlank(input.description ?? null)},
            ${input.txnDate}::date,
            ${"manual"}::transaction_source
          )
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const newId = rows[0]?.id;
    if (!newId) throw new Error("createTransaction: no row returned");
    return newId;
  });

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return { ok: true, id };
}

export async function updateTransaction(
  formData: FormData,
): Promise<TransactionActionResult> {
  const me = await requireCurrentUser();
  const parsed = baseTxnSchema.safeParse(parseFormData(formData));
  if (!parsed.success || !parsed.data.id) {
    return { error: "app.errors.invalidInput" };
  }
  const input = parsed.data;
  const id = input.id!;

  await withUser(me.appUserId, async (tx) => {
    await tx.execute(
      sql`UPDATE transactions SET
            business_id = ${input.businessId}::uuid,
            financial_account_id = ${input.financialAccountId}::uuid,
            direction = ${input.direction}::transaction_direction,
            category_code = ${nullIfBlank(input.categoryCode ?? null)},
            amount_minor = ${toMinor(input.amountMajor, input.currency)}::bigint,
            currency = ${input.currency},
            description = ${nullIfBlank(input.description ?? null)},
            txn_date = ${input.txnDate}::date
          WHERE id = ${id}::uuid`,
    );
  });

  revalidatePath("/transactions");
  revalidatePath(`/transactions/${id}`);
  revalidatePath("/dashboard");
  return { ok: true, id };
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteTransaction(
  formData: FormData,
): Promise<TransactionActionResult | void> {
  const me = await requireCurrentUser();
  const parsed = deleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { id } = parsed.data;

  await withUser(me.appUserId, async (tx) => {
    await tx.execute(sql`DELETE FROM transactions WHERE id = ${id}::uuid`);
  });

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  redirect({ href: "/transactions", locale: await getLocale() });
}
