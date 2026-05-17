"use client";

type InvoiceRow = {
  id: string;
  sequentialNumber: number;
  invoiceType: string;
  issueDate: string;
  dueDate: string | null;
  totalMinor: string;
  currencyAtIssue: string;
  allocationStatus: string;
  cancelledAt: string | null;
};

type BusinessInfo = {
  legalName: string;
  vatId: string;
} | null;

type ClientInfo = {
  id: string;
  legalName: string;
  businessId: string;
};

type Props = {
  token: string;
  data: {
    client: ClientInfo;
    business: BusinessInfo;
    invoices: InvoiceRow[];
  };
};

function formatMinorAmount(minor: string, currency: string): string {
  try {
    const amount = parseInt(minor, 10) / 100;
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return minor;
  }
}

function deriveStatus(invoice: InvoiceRow): {
  label: string;
  className: string;
} {
  if (invoice.cancelledAt) {
    return { label: "בוטל / Cancelled", className: "text-slate-400 line-through" };
  }
  if (
    invoice.allocationStatus === "not_required" ||
    invoice.allocationStatus === "manual_pasted" ||
    invoice.allocationStatus === "partner_issued" ||
    invoice.allocationStatus === "processor_synced" ||
    invoice.allocationStatus === "direct_shaam"
  ) {
    if (invoice.dueDate && new Date(invoice.dueDate) < new Date()) {
      return { label: "באיחור / Overdue", className: "text-red-400 font-medium" };
    }
    return { label: "פתוח / Open", className: "text-amber-400" };
  }
  return { label: "ממתין / Pending", className: "text-slate-400" };
}

function invoiceTypeLabel(type: string): string {
  const map: Record<string, string> = {
    tax_invoice: "חשבונית מס",
    tax_invoice_receipt: "חשבונית מס קבלה",
    receipt: "קבלה",
    credit_note: "זיכוי",
    proforma: "הצעת מחיר",
    debit_note: "חיוב",
    self_invoice: "חשבונית עצמית",
  };
  return map[type] ?? type;
}

export default function ClientPortalView({ data }: Props) {
  const { client, business, invoices } = data;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 space-y-8">
      {/* Header */}
      <header className="space-y-1">
        {business && (
          <p className="text-xs text-slate-500 tracking-wide">
            {business.legalName}
            {business.vatId ? ` · ע.מ. ${business.vatId}` : ""}
          </p>
        )}
        <h1 className="text-2xl font-semibold text-slate-100">
          {client.legalName}
        </h1>
        <p className="text-sm text-slate-400">
          פורטל חשבוניות / Invoice portal
        </p>
      </header>

      {/* Invoice table */}
      <section>
        <h2 className="text-sm font-medium tracking-tight text-slate-300 mb-4">
          חשבוניות / Invoices ({invoices.length})
        </h2>

        {invoices.length === 0 ? (
          <p className="text-slate-500 text-sm py-8 text-center">
            אין חשבוניות עדיין. · No invoices yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm text-slate-300">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 text-start">#</th>
                  <th className="px-4 py-3 text-start">סוג / Type</th>
                  <th className="px-4 py-3 text-start">תאריך / Date</th>
                  <th className="px-4 py-3 text-start">לתשלום עד / Due</th>
                  <th className="px-4 py-3 text-end">סכום / Amount</th>
                  <th className="px-4 py-3 text-start">סטטוס / Status</th>
                  <th className="px-4 py-3 text-start">PDF</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const status = deriveStatus(inv);
                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-slate-400">
                        {inv.sequentialNumber}
                      </td>
                      <td className="px-4 py-3">
                        {invoiceTypeLabel(inv.invoiceType)}
                      </td>
                      <td className="px-4 py-3 tabular-nums" dir="ltr">
                        {inv.issueDate}
                      </td>
                      <td className="px-4 py-3 tabular-nums" dir="ltr">
                        {inv.dueDate ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums" dir="ltr">
                        {formatMinorAmount(inv.totalMinor, inv.currencyAtIssue)}
                      </td>
                      <td className={`px-4 py-3 ${status.className}`}>
                        {status.label}
                      </td>
                      <td className="px-4 py-3">
                        {/* TODO: wire portal-authenticated PDF download once
                            the /portal/{token}/invoices/{id}/pdf route lands.
                            For now show a placeholder. */}
                        <span className="text-slate-600 text-xs">
                          בקרוב / Coming soon
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="text-xs text-slate-600 border-t border-white/5 pt-6">
        <p>
          AccounTech · אומדנים בלבד · Estimates only · Not tax advice.
        </p>
        <p className="mt-1">
          אין לראות בתוכן זה ייעוץ מס. התייעצו עם רואה חשבון מורשה לפני הגשה. /
          This is not tax advice. Consult a licensed CPA before filing.
        </p>
      </footer>
    </main>
  );
}
