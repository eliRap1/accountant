// Public route — no auth required, the JWT IS the auth. We validate the
// token + look up the DB row (revocation + expiry guard) and resolve a
// client_id. Then render a read-only view of the client's invoices.

import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { verifyPortalToken, hashPortalToken } from "@/lib/portal/token";
import ClientPortalView from "./ClientPortalView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export default async function ClientPortalPage(props: Props) {
  const { token } = await props.params;
  const decoded = decodeURIComponent(token);

  // 1. JWT signature + expiry.
  const claims = await verifyPortalToken(decoded);
  if (!claims) notFound();

  // 2. DB revocation + expiry check via service role.
  const tokenHash = hashPortalToken(decoded);
  const dbRow = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id, client_id::text AS "clientId",
                 expires_at AS "expiresAt", revoked_at AS "revokedAt"
          FROM client_portal_tokens
          WHERE token_hash = ${tokenHash}
          LIMIT 1`,
    )) as unknown as Array<{
      id: string;
      clientId: string;
      expiresAt: string;
      revokedAt: string | null;
    }>;
    return rows[0] ?? null;
  });

  if (!dbRow) notFound();
  if (dbRow.revokedAt !== null) notFound();
  if (new Date(dbRow.expiresAt).getTime() < Date.now()) notFound();

  // 3. Stamp last_used_at (fire-and-forget — don't block the render on it).
  withServiceRole(async (tx) => {
    await tx.execute(
      sql`UPDATE client_portal_tokens
          SET last_used_at = now()
          WHERE id = ${dbRow.id}::uuid`,
    );
  }).catch(() => {
    // Non-fatal — analytics best-effort.
  });

  // 4. Fetch the client + business + invoices.
  const data = await withServiceRole(async (tx) => {
    const clientRows = (await tx.execute(
      sql`SELECT id::text, legal_name AS "legalName",
                 business_id::text AS "businessId"
          FROM clients
          WHERE id = ${claims.client_id}::uuid
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as Array<{
      id: string;
      legalName: string;
      businessId: string;
    }>;
    const client = clientRows[0];
    if (!client) return null;

    const businessRows = (await tx.execute(
      sql`SELECT legal_name AS "legalName", vat_id AS "vatId"
          FROM businesses WHERE id = ${client.businessId}::uuid LIMIT 1`,
    )) as unknown as Array<{ legalName: string; vatId: string }>;
    const business = businessRows[0];

    const invoiceRows = (await tx.execute(
      sql`SELECT id::text, sequential_number AS "sequentialNumber",
                 invoice_type AS "invoiceType",
                 issue_date::text AS "issueDate",
                 due_date::text AS "dueDate",
                 total_minor::text AS "totalMinor",
                 currency_at_issue AS "currencyAtIssue",
                 allocation_status::text AS "allocationStatus",
                 cancelled_at AS "cancelledAt"
          FROM invoices
          WHERE client_id = ${claims.client_id}::uuid
            AND deleted_at IS NULL
          ORDER BY issue_date DESC, sequential_number DESC
          LIMIT 200`,
    )) as unknown as Array<{
      id: string;
      sequentialNumber: number;
      invoiceType: string;
      issueDate: string;
      dueDate: string | null;
      totalMinor: string;
      currencyAtIssue: string;
      allocationStatus: string;
      cancelledAt: string | null;
    }>;

    return { client, business: business ?? null, invoices: invoiceRows };
  });

  if (!data) notFound();

  return <ClientPortalView token={decoded} data={data} />;
}
