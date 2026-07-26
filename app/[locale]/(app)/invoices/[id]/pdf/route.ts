// GET /:locale/invoices/:id/pdf
//
// Server-renders the IL tax-invoice PDF via @react-pdf/renderer and
// streams it back with application/pdf. The route uses our standard
// withUser tx so RLS prevents leakage of one user's invoice through
// another user's URL — the SELECT silently returns no rows when the
// invoice is not visible to the caller.
//
// Output is cache-no-store: invoices can be cancelled / re-issued; the
// allocation number may be pasted in after the row exists; and the
// downstream browser does the right thing if it sees a fresh PDF on
// every request.

import * as React from "react";
import { sql } from "drizzle-orm";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import {
  IlTaxInvoice,
  type IlInvoiceRow,
  type IlInvoiceLineRow,
  type IlBusinessRow,
  type IlClientRow,
} from "@/lib/invoices/pdf/IlTaxInvoice";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const me = await requireCurrentUser();

  const data = await withUser(me.appUserId, async (tx) => {
    // Pull the invoice + business + (optional) client in three SELECTs
    // rather than one giant join. Drizzle's typed selects keep the row
    // shapes aligned to the React-PDF component contract.
    const invoiceRows = (await tx.execute(
      sql`SELECT *
          FROM invoices
          WHERE id = ${id}::uuid
          LIMIT 1`,
    )) as unknown as Array<Record<string, unknown>>;
    const invoiceRaw = invoiceRows[0];
    if (!invoiceRaw) return null;

    const businessRows = (await tx.execute(
      sql`SELECT *
          FROM businesses
          WHERE id = ${invoiceRaw["business_id"]}::uuid
          LIMIT 1`,
    )) as unknown as Array<Record<string, unknown>>;
    const businessRaw = businessRows[0];
    if (!businessRaw) return null;

    const clientId = invoiceRaw["client_id"];
    let clientRaw: Record<string, unknown> | null = null;
    if (typeof clientId === "string") {
      const clientRows = (await tx.execute(
        sql`SELECT *
            FROM clients
            WHERE id = ${clientId}::uuid
            LIMIT 1`,
      )) as unknown as Array<Record<string, unknown>>;
      clientRaw = clientRows[0] ?? null;
    }

    const linesRaw = (await tx.execute(
      sql`SELECT *
          FROM invoice_line_items
          WHERE invoice_id = ${id}::uuid
          ORDER BY position ASC`,
    )) as unknown as Array<Record<string, unknown>>;

    return {
      invoice: invoiceRaw,
      business: businessRaw,
      client: clientRaw,
      lines: linesRaw,
    };
  });

  if (!data) {
    return new Response("Not found", { status: 404 });
  }

  // Drizzle's row return shape uses snake_case; the React-PDF component
  // typechecks against the camelCased $inferSelect type. Cast at the
  // boundary — we control both ends.
  function toCamel<T>(row: Record<string, unknown>): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      out[camel] = v;
    }
    return out as T;
  }

  // Bigint columns come back from postgres.js as bigint already; date
  // columns come back as strings (issue_date) or Date (cancelled_at).
  // The PDF component only uses string/bigint/Date — both are fine.
  const invoice = toCamel<IlInvoiceRow>(data.invoice);
  const business = toCamel<IlBusinessRow>(data.business);
  const client = data.client ? toCamel<IlClientRow>(data.client) : null;
  const lines = data.lines.map((ln) => toCamel<IlInvoiceLineRow>(ln));

  // We render via React.createElement rather than JSX so this file can
  // stay `route.ts` (Next.js' route handler convention) without flipping
  // the extension to .tsx for one element. The cast funnels the
  // component's own props type into the @react-pdf renderer signature
  // which expects ReactElement<DocumentProps> — IlTaxInvoice's root is
  // a <Document/>, but TS can't see through the wrapper function.
  const element = React.createElement(IlTaxInvoice, {
    invoice,
    business,
    client,
    lines,
  }) as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);

  const sequentialNumber =
    typeof invoice.sequentialNumber === "number"
      ? invoice.sequentialNumber
      : 0;
  const filename = `invoice-${sequentialNumber}.pdf`;

  // Node Buffer is structurally compatible with BodyInit (Uint8Array).
  // We cast through Uint8Array to satisfy strict Response typing.
  const body = new Uint8Array(buffer);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
