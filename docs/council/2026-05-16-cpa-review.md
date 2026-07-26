# CPA Council Review — Schema + Tax Positioning

**Date:** 2026-05-16
**Reviewer scope:** Working IL CPA lens. Schema layers 1-3 (drizzle files), seeded chart-of-accounts (48 codes), tax positioning copy, Plan v4 § Schema + § Tax Positioning + § Phase D/E/F.
**Tooling note:** This sandbox exposes no WebFetch/WebSearch tool. All gov.il citations are marked `<verify-this-with-CPA>` and the council MUST re-verify before Phase D entry. The handoff and Plan v4 list 2026-05-16 verifications already performed by the previous agent — those are tagged `<inherited-verify>` and inherit the same expiry as the plan's "re-verify at Phase D entry" note.

---

## 1. Executive summary

- **Biggest risk:** schema treats payroll, owner-comp, and tax filings as Layer 3 tables that do not yet exist in `db/schema/`. The eight files we read (`auth.ts`, `identity.ts`, `businesses.ts`, `clients.ts`, `ledger.ts`, `invoicing.ts`, `money-flows.ts`, `billing.ts`, `engagements.ts`, `ops.ts`) cover layers 1 + 2 only. Plan v4 § Schema Layer 3 (`tax_filings`, `tax_advances`, `payroll_*`, `owner_compensation`, etc.) is not in the codebase. A ח.פ. with payroll cannot complete a year-end walk on the current schema.
- The 48 seeded chart-of-accounts codes are missing ~10 routinely-used IL CPA categories (donations 46, vehicle gas vs maintenance split, leasing, pension/keren-hishtalmut for owner, professional indemnity, training).
- `chart_of_accounts.form_6111_line` is a free-text `text` column with no FK and no enum of canonical 6111 lines — the seed uses invented numbering (e.g. `1011`, `2020`, `6010`) that does not match the ITA's published 6111 schedule.
- The dated allocation-threshold rule belongs in BOTH places: hot-path source-of-truth in `lib/tax/il/rules-2026.ts` AND a small immutable `allocation_threshold_history` table — purely for forensic / audit reconstruction five years on. See § 5.
- "Estimates only · Not tax advice" disclaimer wording is adequate but is missing one critical phrase under IL Consumer Protection: it never disclaims **completeness / accuracy of computations** — only the legal classification. See § 7.

---

## 2. Schema completeness — עוסק מורשה year-end walk

**Scenario:** עצמאי, מורשה, ₪40k/month revenue (₪480k/yr — well above the ₪107k 2025 patur cap so morshe is correct `<inherited-verify>`), services only, no employees, single-entry bookkeeping per default.

### Walk

1. **Issue invoice** (Jan ₪40k + 18% VAT = ₪47,200). `invoices` ✓ supports. `invoices.allocation_required_at_issue` ✓ on it. `vat_rate=18` numeric(4,2) ✓.
   - GAP: `vat_rate` numeric(4,2) caps at 99.99 — works for 0/18/exempt today but if ITA ever published a 3-decimal-style rate (e.g. some EU constructs) it overflows. Not a 2026 blocker.
   - GAP: no `payment_term_days` snapshot on invoice itself — currently lives only on `clients.defaultPaymentTermsDays`. If client default changes mid-year the issued invoice loses the term it was issued under. Add `invoices.payment_terms_days_at_issue` int.
2. **VAT collection.** `invoices.vat_minor` ✓. PCN874 export joins invoices+receipts. Schema lacks an explicit `pcn874_report_month` denormalisation but `invoices.issue_date` is enough.
3. **Expenses ledger** — single-entry mode. `transactions` ✓ with `direction=expense`. `receipts` ✓ with `business_use_pct` and `vat_recoverable_minor` ✓ (good, this is critical).
   - GAP: no link between `receipts` and the supplier's `vat_id`. For PCN874 input side ("רשומת תשומה") the ITA expects supplier ID per receipt. Add `receipts.supplier_vat_id` (encrypted or plaintext per § Israeli tax law that supplier VAT-ID on a tax invoice is not PII).
   - GAP: `receipts` has no `invoice_number_from_supplier` field. PCN874 input rows require it.
   - GAP: no `is_vehicle_expense_two_thirds_rule` flag — IL ITA mixed-use 2/3 vehicle rule is one of the most common single-entry mistakes; should be a `vehicle_expense_kind` enum or a `business_use_pct` semantic that knows about the 2/3 floor.
4. **PCN874 generation.** Plan v4 says Phase E ships `lib/filings/pcn874.ts`. `tax_filings` table does not exist in `db/schema/` yet. **BLOCKER for the walk.**
   - When it lands: schema must include the **exempt-input-VAT** sub-totals (סוג עיסקה 1 vs 2 vs 3 etc.). A simple `totals_jsonb` is fine but the inputs_jsonb audit-trail must store row-level evidence keyed by `invoice_id` / `receipt_id` so an ITA visit reconstructs the file from the underlying rows, not a black-box blob.
5. **Form 6111.** Same blocker — table missing. Plus the `form_6111_line` mapping in `chart_of_accounts` uses invented line numbers (see § 4 + § 6).
6. **Annual return (טופס 1301).** `tax_filings` table missing. `owner_compensation` table missing (for the owner-draws line). Single-entry עצמאי still reports owner draws on 1301; current `chart_of_accounts` codes 3100 (משיכות בעלים) ✓ but the equity row alone doesn't bind to a tax-form line.

### Verdict
The עצמאי-morshe walk is partially supported. Invoices + transactions + receipts are there. Filings layer and a few denormalised audit-trail columns are missing.

---

## 3. Schema completeness — חברה בע״מ

**Scenario:** 3-person ח.פ., 2 employees + 1 director, monthly payroll, occasional director loan, year-end dividend declaration.

### Walk

1. **Bookkeeping = double-entry** ✓ enum supports it. `journal_entries` + `journal_lines` ✓ with XOR debit/credit ✓ and non-negative ✓ checks. Trigger for sum-debit=sum-credit deferred to a 0005 migration ✓.
2. **Payroll run** — `payroll_employees`, `payroll_runs`, `form_101_declarations`, `pension_contributions`, `severance_provisions`. **None exist in db/schema/.** BLOCKER.
   - When they land: `payroll_employees.gross_monthly_minor` MUST be encrypted (Plan v4 says so). Make sure the AAD pattern is `{table:payroll_employees, column:gross_monthly_minor, rowId}` per `lib/security/encryption.ts` (verified via the ops.ts dek model).
   - Form 102 (Bituach Leumi) generation: needs a per-period `payroll_runs.form_102_prep_jsonb` per plan. Confirm.
3. **Director loan / shareholder loan.** `owner_compensation` table with `kind` enum (`salary` / `draw` / `dividend` / `loan_to_shareholder` / `shareholder_loan_repayment`) — **does not exist yet.** BLOCKER for ח.פ. completeness.
   - Caveat: IL § 3(ט1) deemed-dividend rule (loans to shareholder outstanding > 1 year are reclassified as dividend with deemed interest). `owner_compensation` table needs at minimum: `outstanding_at_year_end_minor`, `reclassification_date`, `deemed_interest_minor`. A flat `tax_treatment_jsonb` is too loose for a numeric audit trail.
4. **Dividend declaration.** Same table covers it (`kind=dividend`). Schema gap: dividends require a 25% / 30% withholding-tax-at-source line — `owner_compensation` should have `wht_amount_minor` + `wht_rate_pct` columns. JSONB is not enough; the WHT amount flows into form 856.
5. **Form 856** (annual WHT return) — `supplier_wht_rates` exists per plan but **table not in schema**. BLOCKER. Plus needs a one-to-many join with `transactions` where WHT was actually withheld at payment time.
6. **Annual return for ח.פ.** = form 1214. Generation table missing per § 2 / § 3 step 5.

### Verdict
Layer 3 tables exist in Plan v4 prose but not in code. The ח.פ. walk cannot complete on the current commit. **Top schema priority: ship Layer 3 next, before any UI for filings.**

---

## 4. Chart-of-Accounts errata (48 codes in `scripts/db-seed.ts`)

Two systemic findings before the per-code table:

- **(A) 6111 line numbers are wrong.** ITA's uniform digital file (טופס 6111) uses 3-digit primary codes (e.g. line 100 sales, line 250 cost of sales, line 270 wages, line 380 other operating expense, line 500-580 financial, line 9xx balance sheet headings) `<verify-this-with-CPA>` — not the made-up `1011`, `2020`, `6010` style in the seed. Every `form6111Line` value below is therefore tagged `⚠ wrong-form-6111-line`. The seed itself comments "Lines we don't yet have a confirmed mapping for are left as null; Phase D fills them in" — so this is **expected** to be re-derived. Treat the per-line tag below as confirming that intent rather than reporting a bug.
- **(B) `chart_of_accounts.form_6111_line` should be a typed reference, not free text.** Either an enum or a `form_6111_lines(line_number text PK, description_he, description_en, is_primary, parent_line)` table that CoA FKs into. Phase D blocker.

| Code | Name | Verdict | Note |
|---|---|---|---|
| 1000 | Cash on hand | ✓ correct | line wrong, see (A) |
| 1010 | Bank current | ✓ correct | line wrong |
| 1020 | Bank savings | ✓ correct | line wrong |
| 1030 | Credit card receivable | ⚠ wrong-type-classification | for the issuer of cards this is an asset; for a normal business credit card is a LIABILITY. The label "receivable" implies the business is the issuer — unusual for SaaS target persona. Rename to "Credit card clearing - merchant" and keep asset, OR add a 2xxx liability code "כרטיס אשראי לתשלום". |
| 1100 | Accounts receivable | ✓ correct | line wrong |
| 1150 | Checks for collection | ✓ correct | line wrong |
| 1200 | Inventory | ✓ correct | line wrong |
| 1300 | Prepaid expenses / supplier advances | ⚠ wrong-type-classification | combining prepaid (asset, time-decay) with supplier advances (asset, work-completion-decay) into one bucket prevents accurate aging. Split into 1300 and 1310. |
| 1400 | VAT inputs recoverable | ✓ correct | line wrong |
| 1450 | Withholding tax credit (clients withheld) | ✓ correct | form_6111_line=null is correct intent (this is current-asset side, no 6111 mapping until year-end) |
| 1500 | Fixed assets - equipment | ✓ correct | line wrong |
| 1510 | Fixed assets - vehicles | ✓ correct | line wrong; also missing the 1520-1540 series (real-estate, IT equipment, leasehold improvements) |
| 1590 | Accumulated depreciation | ✓ correct | line wrong |
| 2000 | Accounts payable | ✓ correct | line wrong |
| 2100 | VAT outputs payable | ✓ correct | line wrong |
| 2150 | VAT net payable | ⚠ wrong-type-classification | netting VAT inputs vs outputs is usually done via a single "VAT control" account or via separate 1400/2100 with a period-end JE. Having both 2100 AND 2150 invites confusion. Recommend dropping 2150 and computing net at report time. |
| 2200 | Income tax advances payable | ⚠ wrong-type-classification | מקדמות are an ASSET while paid (prepaid tax credit) and only become a liability if you accrue an unpaid one. Either rename to "Income tax advances paid (asset)" → 1460, or keep as liability but rename "Income tax accrued, net of advances". |
| 2250 | WHT payable (we withheld) | ✓ correct | line wrong |
| 2300 | Bituach Leumi payable | ✓ correct | line wrong |
| 2400 | Short-term loans | ✓ correct | line wrong |
| 2500 | Long-term loans | ✓ correct | line wrong |
| 2600 | Accrued expenses | ✓ correct | line wrong |
| 3000 | Owner's equity | ✓ correct | for עצמאי only; חברה uses 3300 share capital |
| 3100 | Owner's draws | ✓ correct | line wrong |
| 3200 | Retained earnings | ✓ correct | line wrong |
| 3300 | Share capital | ✓ correct | line wrong |
| 4000 | Service revenue | ✓ correct | line wrong |
| 4100 | Product revenue | ✓ correct | line wrong |
| 4200 | Export revenue (zero-rated) | ✓ correct | this is the right separation for PCN874 — keep |
| 4900 | Other income | ✓ correct | line wrong |
| 5000 | Cost of goods sold | ✓ correct | line wrong |
| 5100 | Subcontractors | ✓ correct | line wrong; should fork into 5100 with-WHT / 5110 without for form 856 prep |
| 6000 | Advertising & marketing | ✓ correct | line wrong |
| 6100 | Sales commissions | ✓ correct | line wrong |
| 7000 | Rent | ✓ correct | line wrong |
| 7100 | Utilities | ✓ correct | line wrong |
| 7150 | Telephone & internet | ✓ correct | line wrong |
| 7200 | Insurance | ⚠ wrong-type-classification | "ביטוחים" needs at least 3 sub-codes for IL CPA practice: property/liability/vehicle. Vehicle insurance feeds into the 2/3 rule with gas + maintenance; lumping them all under 7200 destroys the breakdown. |
| 7300 | Wages & salaries | ✓ correct | line wrong; needs 7301 directors-fees subdivision for ח.פ. |
| 7310 | Social benefits (employer share) | ✓ correct | line wrong |
| 7400 | Vehicle expenses | ⚠ wrong-type-classification | single "vehicle expenses" code blocks the gas/maintenance/insurance/leasing/depreciation breakdown that the 2/3 rule needs. Must split (see + missing below). |
| 7500 | Professional services | ✓ correct | line wrong; needs 7501 legal / 7502 accountancy / 7503 consulting subdivision because legal fees have special treatment for cap-protected disputes |
| 7600 | Computing & software | ✓ correct | line wrong |
| 7700 | Office supplies | ✓ correct | line wrong |
| 7800 | Depreciation | ⚠ wrong-type-classification | single depreciation code can't distinguish equipment-pchat (33%) from vehicle-pchat (15%) from building-pchat (4%). IL depreciation rates differ wildly by asset class — needs a per-class breakdown (see + missing below). |
| 8000 | Bank fees | ✓ correct | line wrong |
| 8100 | Interest & finance charges | ✓ correct | line wrong |
| 8500 | FX differences | ✓ correct | line wrong |

### + Missing (10 routinely-used IL CPA codes)

| Suggested code | Name (he/en) | Type | Why |
|---|---|---|---|
| 1011 | מע״מ מקדמה / קיזוז שע״ם | asset | shaam credit balance distinct from 1400 input |
| 7401 | דלק לרכב | expense | gas, split off vehicle |
| 7402 | אחזקת רכב | expense | maintenance, split off vehicle |
| 7403 | ליסינג / שכירות רכב | expense | leasing, distinct depreciation treatment |
| 7404 | ביטוח רכב | expense | feeds vehicle 2/3 rule |
| 7250 | ביטוח אחריות מקצועית | expense | professional indemnity (CPA / lawyer / consultant) |
| 7320 | קרן השתלמות מעסיק | expense | keren-hishtalmut employer share — required separation for tax-cap rule on directors |
| 7330 | הכשרה והשתלמויות | expense | training (deductible cap rules) |
| 7510 | תרומות מוכרות סעיף 46 | expense | charitable donations under §46 (35% credit, not deduction) — non-trivial mapping |
| 7801 | פחת רכב | expense | vehicle depreciation distinct from 7800 because rate ≠ equipment rate |

Plus: consider 4910 הכנסות מימון (interest income earned on cash balances) — currently nothing maps the receive-side of finance.

---

## 5. חשבונית-ישראל threshold rule placement

**Recommendation:** Both. Source-of-truth in `lib/tax/il/rules-2026.ts` is correct as the hot path; ADD a tiny `allocation_threshold_history` table for forensic audit.

Reasoning:

- The schema already freezes `invoices.allocation_required_at_issue` BOOLEAN at INSERT (`businesses.ts` Layer-2 file confirms). Good — this is the right pattern for "what was the rule at the moment we issued this".
- The dated rule array in `lib/tax/il/rules-2026.ts` is the right hot-path lookup at issue time.
- BUT: five years on, an ITA audit asks "why did you decide invoice X (issued 2028) was below threshold?" The codebase at that time may have evolved past the 2026 rule. The frozen boolean tells you what was decided, not what rule was applied. A 5-row `allocation_threshold_history (effective_from date, amount_minor bigint, source_url text, verified_at timestamptz, verified_by_cpa text)` table — service-role-only insert — preserves the exact decision rule + the gov.il URL + the CPA who signed it.
- Bonus: this table is then the single source consumed by `lib/tax/il/rules-2026.ts` at boot (cache it) AND surfaced in the disclaimer footer ("rule version effective 2026-06-01, source: <url>, reviewed by <CPA name> on <date>").

This is the "verify, don't assume" principle materialised at the DB level.

---

## 6. Form 6111 line mapping — minimum viable mapping

For a small business return the ITA expects the uniform-digital-file schedule (טופס 6111 / 1301 קובץ דיגיטלי אחיד) `<verify-this-with-CPA>`. Lines a working CPA needs absolutely covered, with proposed CoA → 6111 mappings:

| 6111 line | Description | Proposed mapped CoA codes |
|---|---|---|
| **100** | Sales of services + goods (gross) | 4000 + 4100 |
| **150** | Exports (zero-VAT) | 4200 |
| **190** | Other income | 4900 |
| **250** | Cost of sales / COGS | 5000 + 5100 |
| **270** | Wages & salaries | 7300 + 7301 + 7310 + 7320 |
| **290** | Rent + utilities | 7000 + 7100 + 7150 |
| **350** | Vehicle expenses (post-2/3 rule) | 7400 + 7401 + 7402 + 7403 + 7404 + 7801 |
| **380** | Other operating expense | 6000 + 6100 + 7200 + 7250 + 7500 + 7501 + 7502 + 7503 + 7600 + 7700 + 7330 |
| **500** | Depreciation | 7800 + 7801 |
| **540** | Interest & finance | 8000 + 8100 |
| **580** | FX differences | 8500 |
| **890** | Donations §46 (separate, credit not expense) | 7510 |

Then balance-sheet 9xx series for closing positions. The current 4-digit `form_6111_line` strings in the seed (`1011`, `4010`, `7050`...) don't match this schema — **Phase D must re-derive against the ITA's published 6111 line numbers, then add an FK from CoA to a typed `form_6111_lines` table per § 4 (B).**

`<verify-this-with-CPA>` — specific 3-digit line numbers above are pattern-matched from working CPA practice, not freshly fetched from ITA.

---

## 7. Tax positioning text — legal safety

### Findings

- `app.legal.disclaimer.banner` and `.footer` say "אומדנים בלבד · אינו ייעוץ מס · התייעצו עם רואה חשבון מורשה" (he) / "Estimates only · Not tax advice · Consult a licensed accountant" (en). **This is good but incomplete.**
- The wording disclaims (1) accuracy-classification ("estimates only"), (2) legal advice. It does NOT disclaim (3) completeness of inputs (the user might not have entered every receipt), nor (4) liability for filing errors that arise from selecting the right form / period / VAT category.
- "Consult a licensed accountant" is correct as a steering nudge but is missing the ITA-mandated phrasing for tax-preparation tools per the standard CPA-software industry pattern `<verify-this-with-CPA>`.

### Suggested sharper wording

**Hebrew banner:**

> "התוצאות הן אומדן מבוסס-נתונים-שהזנת בלבד. שלמות ודיוק הנתונים — באחריות המשתמש. אינו ייעוץ מס. לפני הגשה לשע״ם, רשות המסים, או ביטוח לאומי — חובה לקבל אישור מרואה חשבון מורשה (CPA) או יועץ מס (רואה חשבון רשום)."

(Translation: "Results are an estimate based only on data you entered. Completeness and accuracy of the data is the user's responsibility. Not tax advice. Before submitting to SHAAM, ITA, or Bituach Leumi — a licensed CPA or registered tax-advisor sign-off is required.")

**English banner:**

> "Results are an estimate computed from data you provided. Completeness and accuracy of inputs are your responsibility. This is not tax advice. Before submitting any filing to the Israeli Tax Authority, SHAAM, or Bituach Leumi, obtain sign-off from a licensed CPA or registered tax-advisor."

### Reasoning under IL Consumer Protection Law `<verify-this-with-CPA>`

- IL Consumer Protection Law § 2 prohibits misleading-by-omission. The current banner omits the "garbage-in" caveat — a user can plausibly argue the software promised an accurate VAT estimate, and the actual estimate was wrong because they forgot to enter 3 receipts. Adding "based only on data you entered" closes that.
- The wording "התייעצו עם" (consult) is softer than the proposed "חובה לקבל אישור מרואה חשבון מורשה" (CPA sign-off required). Stronger phrasing protects the platform if a user files self-served and is audited.
- The footer SR (screen-reader) version is currently identical to the banner — keep, but make sure aria-live region announces on page entry, not just on hover (per accessibility regulations `<verify-this-with-CPA>`).

### Other strings flagged

- Hero desc: "אומדנים בלבד · אינו ייעוץ מס · התייעצו עם רואה חשבון מורשה" — same fix needed.
- Footer tagline: "תוכנה, לא משרד רו״ח" — strong, keep.
- `il-privacy-registration.md:167` says "Subscription accounting + tax-estimate SaaS" — acceptable phrasing for the IL Privacy Authority.

---

## 8. Killer feature for the ₪399 Accountant tier

**Pick: "ITA-audit-package builder" — one-click bundle for ביקורת רשות המסים.**

Why it wins vs Hashavshevet / CPA-tax / Rivhit-Mokeed:

- Israeli CPAs servicing 20+ small clients lose 2-4 hours per ITA visit assembling: PCN874 history, receipts (scanned), bank-reconciliation PDFs, year-end financial statements, 6111 filings, payroll 102 history, owner-comp journal, and an explanation memo. Hashavshevet exports raw GL; it does not bundle context. CPA-tax stops at filing.
- AccounTech already has every artifact in encrypted Blob (`receipts.file_blob_url`, `financial_statements.file_ciphertext`, `tax_filings.file_ciphertext` once Layer 3 lands). The `audit_packages` table is already specced in Plan v4.
- One-click action: select business + period range → generate encrypted ZIP with manifest_jsonb describing every artifact, sign with the CPA's session key, drop into a shareable link the CPA forwards to the ITA inspector. The manifest includes provenance for every line ("invoice #4023 issued 2026-04-12 via Green Invoice, allocation #SHM-...") — exactly what an inspector asks for.
- **Defensibility:** Hashavshevet etc. are accounting engines. The audit-package is an engagement asset that depends on `accountant_engagements` ✓ + `risk_flags` ✓ + every artifact table — i.e. requires the multi-business view the Accountant tier exclusively unlocks. Competitor would have to re-architect for tenancy.

Secondary feature shortlist (rejected as killer but useful): cross-client deduction-rate benchmarking, partial-year fiscal-period handover (so a new CPA can pick up mid-year), batch-PCN874 submission queue.

---

## 9. Disagreements with Plan v4

1. **Plan § Schema Layer 3 is paper-only.** Plan describes ~25 tables but the code repo has Layer 1 + 2. Status badge "Phase B.1 (schema Layer 2) shipped" matches; but the plan's prose talks about Layer 3 as if existing. Tighten the plan to mark Layer 3 as "spec only — not in schema".
2. **`form_6111_line` is `text` in the schema but the plan implies it maps to a fixed enumeration.** Either tighten plan to "free text, validated at runtime against `lib/tax/il/form6111Lines.ts`" or add the typed reference per § 4 (B). The schema's `text` will eventually drift.
3. **Plan tax-positioning copy is good but missing the completeness-of-inputs caveat** (§ 7). Update the rules-2026.meta.json schema to record which disclaimer wording version is in production — version-stamping legal copy is treated lightly today.
4. **Plan says VAT-day load test "1000 concurrent PCN874 generations".** For a 5-business-cap (Business/Accountant tiers max 5 businesses, see seed `entitlements.businesses.max`), 1000 concurrent is unrealistic. Real load is more like 50-100 concurrent (one tax day, all customers triggering at once). Drop the target; it's vanity.
5. **Plan claims processor-sync pulls `קבלה` (receipts) not invoices** (handoff line 33). Good rescope. But the schema `processor_sync_credentials.syncedDocKind` is `text("synced_doc_kind").notNull().default("receipt")` — should be a typed enum to prevent drift.
6. **Plan says "₪40k/month עצמאי" persona but Free tier caps at 10 invoices/month** (seed). A ₪40k עצמאי often issues only 1-2 invoices/month if they have 1-2 retainer clients. Free tier is therefore plausible for the high-end-low-volume persona, which contradicts the upsell story. Marketing copy needs to lean on AI-messages / OCR / processor-sync, not invoice volume.
7. **The "estimates + planning only" guardrail conflicts with the audit-package builder feature** (§ 8). Generating an audit package implies the data is structured well enough for the ITA — that's no longer "estimates only". The legal team needs to bless that the audit package is a *user-collated artifact*, not platform certification.

---

## 10. Verified sources

- **WebFetch unavailable in this sandbox.** All gov.il and ITA citations referenced in this memo inherit the verification stamp from Plan v4 / handoff (last verified by the previous agent on 2026-05-16). Phase D entry MUST re-verify the following before any CPA sign-off:
  - VAT rate 18% — gov.il/he/Departments/topics/vat — `<inherited-verify 2026-05-16>`
  - Income tax brackets — gov.il/he/Departments/taxes/income_tax_brackets — `<inherited-verify 2026-05-15>`
  - חשבונית-ישראל threshold (June 1, 2026 → ₪5,000 pre-VAT) — gov.il/he/Departments/topics/shaam-electronic-invoice — `<inherited-verify 2026-05-16>`
  - Credit-point annual value — gov.il/he/Departments/taxes/credit_points — `<verify-this-with-CPA>`
  - Bituach Leumi ceiling + brackets — btl.gov.il/Insurance/Insurance_rates — `<verify-this-with-CPA>`
  - Form 6111 line schedule + 1301 / 1214 / 102 / 856 / 126 form specs — taxes.gov.il/InCometax/Pages — `<verify-this-with-CPA>`
  - § 3(ט1) deemed-dividend rule — taxes.gov.il/IncomeTax/Pages/TaxOrdinanceArticle3T1 — `<verify-this-with-CPA>`
  - Vehicle 2/3 rule — taxes.gov.il/IncomeTax/Pages/VehicleExpenseRule — `<verify-this-with-CPA>`
  - IL Consumer Protection Law § 2 (misleading-by-omission) — moital.gov.il/he/consumer-protection — `<verify-this-with-CPA>`
  - Charitable donations §46 — taxes.gov.il/IncomeTax/Pages/Donations46 — `<verify-this-with-CPA>`

**All URL paths above are pattern-shaped from training data — they MUST be fetched and confirmed live before being baked into `rules-2026.meta.json` as authoritative.**

---

## Closing note

Adopt § 4 + § 6 as the Phase D opening checklist (CoA rebuild + 6111 mapping table + typed reference). Adopt § 7 as a copy-deck update before any paying user signs up. Adopt § 5 as a small schema PR. § 8 (audit-package builder) is the wedge for the Accountant tier — it should headline the ₪399 positioning before any other Accountant-only feature is built. § 9 items are plan-doc edits, not code.
