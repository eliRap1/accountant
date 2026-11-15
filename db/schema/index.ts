// Re-export every schema module so Drizzle's relational queries can resolve relations.
// New schema files MUST be added here.
export * from "./auth";
export * from "./identity";
export * from "./businesses";
export * from "./engagements";
export * from "./billing";
export * from "./ops";
// Layer 2
export * from "./clients";
export * from "./ledger";
export * from "./invoicing";
export * from "./money-flows";
// Layer 3
export * from "./tax-filings";
export * from "./payroll";
export * from "./compliance";
// Errata / governance
export * from "./coa-errata";
// AI tax-advisor (Phase D Layer 1)
export * from "./ai";
// Bank connections — AISP live-link stub (Salt Edge integration pending)
export * from "./bank-connections";
// NOTE: db/schema/scheduled.ts deliberately not re-exported here —
// it only re-exports from invoicing.ts (Layer 2) for documentary cohesion;
// including it would produce duplicate exports.
