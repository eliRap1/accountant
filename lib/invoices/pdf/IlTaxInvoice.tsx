// IL-compliant tax-invoice PDF.
//
// Renders any of the 7 invoice types (tax_invoice, tax_invoice_receipt,
// receipt, credit_note, proforma, debit_note, self_invoice) into a
// react-pdf React tree. The actual `renderToBuffer` call lives in the
// Phase C route handler — this module is the pure component.
//
// Layout rules:
//   - RTL primary direction with Hebrew labels.
//   - English fallback labels in parentheses for international clients.
//   - Header: business legal_name, vat_id, address, logo (if set).
//   - Recipient block: client legal_name, vat_id, address.
//   - Body table: position / description / qty / unit_price / vat_rate / line_total.
//   - Totals footer: subtotal / vat / total in currencyAtIssue.
//   - Allocation number prominently displayed when assigned.
//   - "Cancelled" watermark when `cancelled_at IS NOT NULL`.
//   - Small disclaimer: "AccounTech — אומדנים בלבד · אינו ייעוץ מס"
//
// Note: We do NOT call `Font.register` here. The default Helvetica font
// in @react-pdf/renderer 4.5.x has limited Hebrew glyph coverage. Phase
// C route handler is expected to register a Hebrew-capable font (e.g.
// Heebo or Open Sans Hebrew) before rendering. <verify-this>

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import { Document, Page, View, Text, StyleSheet, Image } from "@react-pdf/renderer";
import type { invoices, invoiceLineItems } from "@/db/schema/invoicing";
import type { businesses } from "@/db/schema/businesses";
import type { clients } from "@/db/schema/clients";

export type IlInvoiceRow = typeof invoices.$inferSelect;
export type IlInvoiceLineRow = typeof invoiceLineItems.$inferSelect;
export type IlBusinessRow = typeof businesses.$inferSelect;
export type IlClientRow = typeof clients.$inferSelect;

type InvoiceType = IlInvoiceRow["invoiceType"];

const INVOICE_TYPE_LABELS_HE: Record<InvoiceType, string> = {
  tax_invoice: "חשבונית מס",
  tax_invoice_receipt: "חשבונית מס/קבלה",
  receipt: "קבלה",
  credit_note: "חשבונית זיכוי",
  proforma: "חשבון עסקה",
  debit_note: "חשבונית חיוב",
  self_invoice: "חשבונית עצמית",
};

const INVOICE_TYPE_LABELS_EN: Record<InvoiceType, string> = {
  tax_invoice: "Tax Invoice",
  tax_invoice_receipt: "Tax Invoice / Receipt",
  receipt: "Receipt",
  credit_note: "Credit Note",
  proforma: "Proforma",
  debit_note: "Debit Note",
  self_invoice: "Self Invoice",
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111111",
    // Default direction is left-to-right in @react-pdf; we lay out the
    // page with right-aligned containers to approximate RTL visually
    // without needing the Bidi shaper.
  },
  // Watermark for cancelled invoices.
  watermark: {
    position: "absolute",
    top: 220,
    left: 80,
    transform: "rotate(-30deg)" as any,
    color: "rgba(200, 30, 30, 0.18)",
    fontSize: 96,
    fontWeight: "bold",
    letterSpacing: 8,
  },
  // Header section.
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: "column",
  },
  headerRight: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  logo: {
    width: 80,
    height: 40,
    objectFit: "contain",
  },
  businessName: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 2,
    textAlign: "right",
  },
  small: {
    fontSize: 9,
    color: "#555555",
  },
  // Section title (e.g. "חשבונית מס · Tax Invoice  #00041").
  docTitle: {
    fontSize: 13,
    fontWeight: "bold",
    marginTop: 8,
    marginBottom: 4,
    textAlign: "right",
  },
  docMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  recipientBox: {
    borderWidth: 0.5,
    borderColor: "#cccccc",
    padding: 8,
    marginBottom: 12,
  },
  recipientTitle: {
    fontSize: 9,
    color: "#555555",
    marginBottom: 4,
    textAlign: "right",
  },
  table: {
    flexDirection: "column",
    marginTop: 8,
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f1f1",
    paddingVertical: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.25,
    borderBottomColor: "#dddddd",
    paddingVertical: 4,
  },
  cellPos: { width: "8%", textAlign: "center" },
  cellDesc: { width: "40%", textAlign: "right" },
  cellQty: { width: "12%", textAlign: "right" },
  cellPrice: { width: "16%", textAlign: "right" },
  cellVat: { width: "10%", textAlign: "right" },
  cellTotal: { width: "14%", textAlign: "right" },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 4,
  },
  totalsLabel: {
    width: "20%",
    textAlign: "right",
    paddingRight: 6,
    color: "#555555",
  },
  totalsValue: {
    width: "14%",
    textAlign: "right",
    fontWeight: "bold",
  },
  allocationBox: {
    marginTop: 12,
    padding: 6,
    borderWidth: 0.5,
    borderColor: "#88aacc",
    backgroundColor: "#f1f7ff",
  },
  allocationLabel: {
    fontSize: 9,
    color: "#445566",
    textAlign: "right",
  },
  allocationValue: {
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "right",
  },
  disclaimer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#999999",
    textAlign: "center",
  },
});

function formatMinor(
  amountMinor: bigint | string | number,
  currency: string,
): string {
  // The DB driver (postgres-js) returns int8 / bigint columns as plain
  // strings unless told otherwise. The route fetches via `SELECT *` so
  // the runtime shape diverges from the typed `IlInvoiceRow` (which
  // promises bigint). Coerce defensively so a string-typed value cannot
  // explode the bigint comparison `< 0n` with "Cannot mix BigInt and
  // other types".
  const v =
    typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const major = abs / 100n;
  const minor = abs % 100n;
  const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const minorStr = minor.toString().padStart(2, "0");
  return `${sign}${majorStr}.${minorStr} ${currency}`;
}

export type IlTaxInvoiceProps = {
  invoice: IlInvoiceRow;
  business: IlBusinessRow;
  client: IlClientRow | null;
  lines: IlInvoiceLineRow[];
};

/**
 * The PDF component. Pass into `renderToBuffer(<IlTaxInvoice .../>)` from
 * the Phase C route to get a Buffer suitable for an HTTP response body
 * or a Vercel Blob upload.
 */
export function IlTaxInvoice(props: IlTaxInvoiceProps): React.ReactElement {
  const { invoice, business, client, lines } = props;
  const titleHe = INVOICE_TYPE_LABELS_HE[invoice.invoiceType];
  const titleEn = INVOICE_TYPE_LABELS_EN[invoice.invoiceType];
  const isCancelled = invoice.cancelledAt !== null;

  return (
    <Document
      title={`${titleEn} #${invoice.sequentialNumber}`}
      author={business.legalName}
      language="he"
    >
      <Page size="A4" style={styles.page}>
        {isCancelled ? (
          <Text style={styles.watermark}>בוטלה / CANCELLED</Text>
        ) : null}

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {business.logoBlobUrl ? (
              <Image src={business.logoBlobUrl} style={styles.logo} />
            ) : null}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.businessName}>{business.legalName}</Text>
            <Text style={styles.small}>
              ע.מ./ח.פ. {business.vatId} · VAT/Co. ID
            </Text>
            {business.addressStreet ? (
              <Text style={styles.small}>
                {business.addressStreet}
                {business.addressCity ? `, ${business.addressCity}` : ""}
                {business.addressPostalCode
                  ? ` ${business.addressPostalCode}`
                  : ""}
              </Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.docTitle}>
          {titleHe} · {titleEn} #{invoice.sequentialNumber}
        </Text>

        <View style={styles.docMeta}>
          <Text style={styles.small}>
            תאריך הנפקה / Issue date: {invoice.issueDate}
          </Text>
          {invoice.dueDate ? (
            <Text style={styles.small}>
              תאריך פירעון / Due date: {invoice.dueDate}
            </Text>
          ) : null}
          <Text style={styles.small}>
            מטבע / Currency: {invoice.currencyAtIssue}
          </Text>
        </View>

        {client ? (
          <View style={styles.recipientBox}>
            <Text style={styles.recipientTitle}>
              לכבוד / Recipient
            </Text>
            <Text style={{ textAlign: "right", fontWeight: "bold" }}>
              {client.legalName}
            </Text>
            {client.vatId ? (
              <Text style={[styles.small, { textAlign: "right" }]}>
                ע.מ./ח.פ. {client.vatId}
              </Text>
            ) : null}
            {client.addressStreet ? (
              <Text style={[styles.small, { textAlign: "right" }]}>
                {client.addressStreet}
                {client.addressCity ? `, ${client.addressCity}` : ""}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.cellPos}>#</Text>
            <Text style={styles.cellDesc}>תיאור · Description</Text>
            <Text style={styles.cellQty}>כמות · Qty</Text>
            <Text style={styles.cellPrice}>מחיר · Unit</Text>
            <Text style={styles.cellVat}>מע"מ · VAT</Text>
            <Text style={styles.cellTotal}>סה"כ · Line</Text>
          </View>
          {lines.map((line) => (
            <View key={line.id} style={styles.tableRow}>
              <Text style={styles.cellPos}>{line.position}</Text>
              <Text style={styles.cellDesc}>{line.description}</Text>
              <Text style={styles.cellQty}>{line.quantity}</Text>
              <Text style={styles.cellPrice}>
                {formatMinor(line.unitPriceMinor, invoice.currencyAtIssue)}
              </Text>
              <Text style={styles.cellVat}>{line.vatRate}%</Text>
              <Text style={styles.cellTotal}>
                {formatMinor(line.lineTotalMinor, invoice.currencyAtIssue)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>סכום · Subtotal</Text>
          <Text style={styles.totalsValue}>
            {formatMinor(invoice.subtotalMinor, invoice.currencyAtIssue)}
          </Text>
        </View>
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>
            מע"מ {invoice.vatRate}% · VAT
          </Text>
          <Text style={styles.totalsValue}>
            {formatMinor(invoice.vatMinor, invoice.currencyAtIssue)}
          </Text>
        </View>
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>סה"כ לתשלום · Total</Text>
          <Text style={styles.totalsValue}>
            {formatMinor(invoice.totalMinor, invoice.currencyAtIssue)}
          </Text>
        </View>

        {invoice.allocationNumber ? (
          <View style={styles.allocationBox}>
            <Text style={styles.allocationLabel}>
              מספר הקצאה / Allocation number (חשבונית ישראל)
            </Text>
            <Text style={styles.allocationValue}>
              {invoice.allocationNumber}
            </Text>
          </View>
        ) : null}

        {invoice.notesHe ? (
          <Text style={{ marginTop: 12, textAlign: "right" }}>
            {invoice.notesHe}
          </Text>
        ) : null}
        {invoice.notesEn ? (
          <Text style={{ marginTop: 4, textAlign: "left" }}>
            {invoice.notesEn}
          </Text>
        ) : null}

        <Text style={styles.disclaimer}>
          AccounTech — אומדנים בלבד · אינו ייעוץ מס · Estimates only — not tax advice
        </Text>
      </Page>
    </Document>
  );
}
