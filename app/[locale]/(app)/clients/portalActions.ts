"use server";

import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { signPortalToken, hashPortalToken } from "@/lib/portal/token";
import { sendEmail } from "@/lib/email/client";
import { decryptStringWithKey } from "@/lib/security/encryption";
import { getKek } from "@/lib/security/kek";
import { env } from "@/lib/env";

export type IssuePortalLinkResult =
  | { ok: true }
  | {
      error:
        | "client_not_found"
        | "client_missing_email"
        | "client_email_decrypt_failed"
        | "email_send_failed";
    };

export async function issueClientPortalLink(
  clientId: string,
): Promise<IssuePortalLinkResult> {
  const me = await requireCurrentUser();

  // 1. Confirm caller owns the client's business + fetch client metadata.
  const clientRow = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT c.id::text, c.legal_name AS "legalName",
                 c.business_id::text AS "businessId",
                 c.email_ciphertext AS "emailCiphertext"
          FROM clients c
          WHERE c.id = ${clientId}::uuid
            AND c.deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as Array<{
      id: string;
      legalName: string;
      businessId: string;
      emailCiphertext: string | null;
    }>;
    return rows[0] ?? null;
  });

  if (!clientRow) {
    return { error: "client_not_found" } as const;
  }
  if (!clientRow.emailCiphertext) {
    return { error: "client_missing_email" } as const;
  }

  // 2. Decrypt the client's email using the KEK directly (same pattern as
  //    the client actions — clients.email_ciphertext uses KEK-direct
  //    AES-GCM with AAD {table, column, rowId}).
  let toEmail: string;
  try {
    toEmail = decryptStringWithKey({
      key: getKek(),
      ciphertext: clientRow.emailCiphertext,
      aad: {
        table: "clients",
        column: "email_ciphertext",
        rowId: clientRow.id,
      },
    });
  } catch {
    return { error: "client_email_decrypt_failed" } as const;
  }

  // 3. Insert a row in client_portal_tokens via service role and sign the JWT.
  const ttlDays = 30;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);

  // Generate the jti (which becomes client_portal_tokens.id), sign the JWT
  // with it, hash the resulting JWT, then INSERT all three.
  const jti = crypto.randomUUID();
  const jwt = await signPortalToken(
    {
      client_id: clientRow.id,
      business_id: clientRow.businessId,
      jti,
    },
    ttlDays * 86_400,
  );
  const tokenHash = hashPortalToken(jwt);

  await withServiceRole(async (tx) => {
    await tx.execute(
      sql`INSERT INTO client_portal_tokens
            (id, client_id, token_hash, issued_by_user_id, expires_at)
          VALUES (${jti}::uuid, ${clientRow.id}::uuid, ${tokenHash},
                  ${me.appUserId}::uuid, ${expiresAt.toISOString()}::timestamptz)`,
    );
  });

  // 4. Email the magic link.
  const baseUrl =
    process.env["BETTER_AUTH_URL"] ?? "https://accountant-kappa.vercel.app";
  const portalUrl = `${baseUrl}/portal/${encodeURIComponent(jwt)}`;

  const sendResult = await sendPortalEmail(
    toEmail,
    clientRow.legalName,
    portalUrl,
  );
  if ("error" in sendResult) {
    return { error: "email_send_failed" } as const;
  }

  return { ok: true } as const;
}

async function sendPortalEmail(
  to: string,
  name: string,
  url: string,
): Promise<{ id: string; skipped?: boolean } | { error: { message: string } }> {
  // TODO: i18n template — wire a proper bilingual template once the email
  // template system supports portal-specific layouts. For now: a minimal
  // bilingual HE+EN plain-text body that satisfies deliverability.
  const subject = "הגישה לפורטל החשבוניות שלך ב-AccounTech / Your AccounTech invoice portal";
  const text = [
    `שלום ${name},`,
    "",
    "לחצו על הקישור הבא כדי לצפות בחשבוניות שלכם:",
    url,
    "",
    "הקישור תקף ל-30 יום.",
    "",
    "---",
    "",
    `Hello ${name},`,
    "",
    "Click the link below to view your invoices:",
    url,
    "",
    "The link is valid for 30 days.",
    "",
    "AccounTech · אומדנים בלבד · Estimates only · Not tax advice",
  ].join("\n");

  return sendEmail({
    to,
    subject,
    text,
    kind: "support",
  });
}
