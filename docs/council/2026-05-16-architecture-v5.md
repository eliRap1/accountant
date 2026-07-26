# AccounTech Architecture v5 — Remaining Slices

Drafted 2026-05-16 after Phase A–F.1 + security remediation + 3 council reviews shipped. Covers the work that converts current "scaffolding" into a "deeply needed" product per the user's goal.

## 1. Schema Layer 3 — 15 tables

Required before Phase E filings UI + Audit Package Builder + payroll surfaces ship.

| Table | Purpose | RLS scope |
|---|---|---|
| `tax_filings` | encrypted artifact storage per filing (PCN874 / 6111 / 102 / 1301 / 1214 / 126 / 856) | business engagement |
| `tax_advances` | מקדמות period × declared_revenue × rate × paid × asmachta | business engagement |
| `client_wht_certificates` | clients withhold from us | business engagement |
| `supplier_wht_rates` | we withhold from suppliers → form 856 | business engagement |
| `payroll_employees` | encrypted national_id, gross_monthly_minor, credit_points, bituach_leumi_class | business engagement + step-up to decrypt |
| `payroll_runs` | per-period totals + per-employee_breakdown (encrypted), form_102_prep_jsonb | business engagement |
| `form_101_declarations` | annual employee tax declaration; 7yr retention | business engagement |
| `pension_contributions` | per-employee per-period | business engagement |
| `severance_provisions` | פיצויים accrual + payouts | business engagement |
| `owner_compensation` | salary / draw / dividend / loan_to_shareholder / shareholder_loan_repayment | business engagement (ח.פ. only) |
| `risk_flags` | round_number / weekend_cash / vendor_new_high / split_below_threshold / unusual_vat_rate | business engagement |
| `inventory_counts` | period-end inventory snapshots | business engagement |
| `audit_packages` | bundle for ITA visit — encrypted ZIP blob URL + manifest | business engagement + step-up to download |
| `recurring_invoice_templates` | cadence × template_jsonb | business engagement |
| `invoice_reminders` | per-invoice scheduled reminders | business engagement (via invoice) |

Migration `0007_schema_layer3.sql` + `0008_rls_layer3.sql`. Encryption: per-purpose DEKs (envelope) via `lib/security/dek.ts`. Use the same SECURITY DEFINER helper pattern as Layer 1+2.

## 2. UI consumers

### Invoices (Phase C UI)
`/[locale]/(app)/invoices/{page,new,[id],[id]/edit}` — 7 invoice types via enum picker; allocation banner uses `lib/invoices/allocationThreshold.ts`; PDF download via `lib/invoices/pdf/IlTaxInvoice.tsx`; provider selection via `lib/invoices/providers/selectProvider` (defaults to manual; F.4 swaps to greenInvoice when credentials exist).

### Tax (Phase D UI)
`/[locale]/(app)/tax/page.tsx` — calls `runFullTaxEngine(userId)`, renders breakdown + `EstimatesDisclaimer`. Sub-tabs per Product council: מע״מ / מקדמות / סיום שנה.

### Filings (Phase E UI)
`/[locale]/(app)/filings/{page,new}` — wizard per form (PCN874 first since most common). Step-up gate on download. File label "ready for portal upload" — never "filed". Marks `tax_filings.submitted_at` only when user confirms.

### AI Advisor (Phase D UI)
`/[locale]/(app)/ai/{page,[conversationId]}` — chat panel. System prompt + `ensureDisclaimer` from `lib/ai/prompt.ts`. Snapshot from `lib/ai/snapshot.ts` prepended as system message.

### Receipts (Phase F.3 UI)
`/[locale]/(app)/receipts/{page,upload,[id]}` — drag-drop, OCR via `lib/receipts/ocr.ts` (NEW: OpenAI vision via AI Gateway), business_use_pct picker, vat_recoverable_minor calc. Vercel Blob private storage.

### Bank imports (Phase F.2 UI)
`/[locale]/(app)/bank-imports/{page,upload,[id]}` — drop-zone for CSV/PDF/OFX. Parsers per bank (NEW: `lib/bank-imports/{leumi,hapoalim,mizrahi,discount,ofx,csv,greenInvoiceCsv}.ts`). Dedup via `lib/recon/dedup.ts` (already exists).

### Processor sync (Phase F.4 UI)
`/[locale]/(app)/processor-sync/{page,connect}` — connect Hyp / Grow / PayPlus; encrypted credentials via envelope DEK; last-synced banner; orphan-receipts list (paired vs unpaired).

## 3. Killer features

### Morning Tax Brief (Product council)
- `lib/ai/morningBrief.ts` — composes the plain-Hebrew/English sentence
- `app/api/cron/morning-brief/route.ts` — fires daily at 08:00 Asia/Jerusalem
- `lib/email/templates/{he-IL,en-US}/morning-brief.tsx`
- Dashboard card `components/app/dashboard/MorningBriefCard.tsx`
- Per-user opt-out toggle in settings
- Idempotency: only send once per user per day

### Audit Package Builder (CPA council, ₪399 tier)
- `lib/audit/packageBuilder.ts` — assembles ZIP manifest
- `app/api/audit/build/route.ts` — POST step-up-gated
- Encrypted ZIP via Vercel Blob private; per-package DEK in `data_encryption_keys`
- Manifest JSON: every artifact + provenance (which PCN874 export, which transactions, which receipts, etc.)
- UI `/[locale]/(app)/audit/{page,new,[id]/download}`

## 4. Dashboard redesign

Replace ARR / EBITDA / YoY tiles with the 6 canonical CPA-relevant KPIs:

1. **VAT due this period** — from `runFullTaxEngine.vat.netPayableMinor`
2. **Cash on hand** — sum of `financial_accounts.opening_balance` + sum of transactions
3. **Overdue invoices** — count + sum where `due_date < now() AND status != 'paid'`
4. **Uncategorised receipts** — count where `status = 'pending_review'`
5. **מקדמות paid vs due** — from `tax_advances` table
6. **Monthly profit trend** — 6-month line chart of (income - expense)

Keep `RevenueEbitdaChart` available as an Accountant-tier secondary view.

## 5. Onboarding cuts

Current: 10 steps / 22 inputs. Target: **2 steps / 8 inputs.**

- **Step 1 — Account** (signup form): name, email, password (no confirm — show plaintext toggle), accept ToS (single checkbox covering Terms + Privacy + Disclaimer). 4 inputs total + Turnstile.
- **Step 2 — Business** (post-verify): legal name, VAT ID (auto-detect `entity_type` from checksum + revenue heuristic), city. 3 inputs. Defaults: `vat_status = osek_morshe` (most common; user can change in settings later), `bookkeeping_method = single_entry` (unless entity_type detected as `hevra_baam`), `tax_year_end_month = 12`, `default_currency = ILS`, `address_country = IL`.

First transaction prompt becomes a dashboard CTA, not an onboarding step.

## 6. IA changes

Sidebar (per Product council):
- **Before:** Dashboard / Businesses / Clients / Transactions / Ledger / Invoices / Receipts / Settings
- **After:** Dashboard / Invoices / Receipts-and-Expenses / Transactions / Clients / Tax (sub-tabs: מע״מ / מקדמות / סיום שנה) / Settings
- **Header:** business switcher (replaces top-level Businesses); accountant tier shows engagement switcher
- **Ledger:** hidden from single-entry users; visible for `hevra_baam` + accountant engagements

## 7. CoA errata (CPA council)

Migration `0009_coa_fixes.sql`:
- Code **1030** "Credit card receivable" — reclassify type asset → liability. Update existing rows.
- Code **2150** "VAT net payable" — drop (phantom of 2100). Update any references.
- Code **7400** "Vehicle expenses" — split into 5 sub-codes (gas / maintenance / insurance / leasing / depreciation). New codes 7401-7405.
- Add the 5-10 missing codes CPA council flagged: donations (8100), depreciation expense (8200), professional indemnity insurance (8300), etc.

## 8. Step-up wiring (council C-2 finish)

Registry is complete in `lib/auth/stepUp.ts`. Wire `requireFreshSession` at:
- `app/[locale]/(app)/invoices/actions.ts` → `invoice.issue_high_value` when amount ≥ active threshold
- `app/api/filings/[id]/download/route.ts` → `filing.export_pcn874` (and per form)
- PII decrypt routes (need to define them — e.g. `/api/clients/[id]/decrypt` for email/phone reveal) → `pii.decrypt_*`
- `app/[locale]/(app)/processor-sync/actions.ts` → `processor.view_credentials`
- 2FA disable/MFA reset routes → `mfa.disable` / `mfa.reset`
- Accountant engagement claim route → `engagement.claim`

## 9. DEK migration

Existing ciphertext columns (clients.email_ciphertext, etc.) currently encrypted under master KEK directly. Migrate:
- Generate per-purpose DEKs for each `(business_id, column)` purpose
- Re-encrypt each row's ciphertext under its DEK
- Update column to store `{dekId, ciphertext}` instead of bare ciphertext
- One-time migration script + integration test

## 10. Quality polish

- `qrcode` npm package → render QR for `/2fa/enroll` totpURI
- `generateMetadata` async exports replacing static `metadata.title` on all `(auth)` + `(app)` page.tsx files
- E2E pixel-diff baselines (`pnpm test:e2e --update-snapshots`)
- Vercel region `iad1` → `fra1` in `vercel.json`

## 11. Implementation order

Dependency-driven:

1. **Layer 3 schema migration** (unblocks #2, #5, #6)
2. **CoA errata + DEK migration** (data-cleanup migrations alongside Layer 3)
3. **Invoices UI** (parallel with Layer 3 — no deps)
4. **Tax UI + AI Advisor UI** (parallel — Phase D libs already exist)
5. **Filings UI** (depends on Layer 3 #1)
6. **Receipts + Bank-imports + Processor-sync UIs** (parallel — Phase F libs need writing)
7. **Morning Tax Brief** (parallel — Phase D snapshot + email templates exist)
8. **Audit Package Builder** (depends on Layer 3 #1 + all artifact-producing routes)
9. **Dashboard redesign + onboarding cuts + IA changes** (parallel — pure UI refactor)
10. **Step-up wiring** (parallel — registry done)
11. **QR rendering + generateMetadata + pixel-diff baselines** (polish)

## Open architectural questions for the council

(Asked in sibling memo `2026-05-16-architecture-v5-council-questions.md`.)

1. **Layer 3 schema scope:** ship all 15 tables at once or layered? If layered, what's the dependency order?
2. **Morning Tax Brief:** daily fire even if no new data? Skip weekends? Per-user quiet-hours setting? Email + push or in-app card only?
3. **Audit Package Builder:** who can trigger — owner only, or also any `accountant_engagement.role = 'accountant'`? Per-package DEK or per-business?
4. **CoA errata:** silent fix (migration alters seed) or surface to existing users via a one-time review modal?
5. **Onboarding cuts:** dropping vat_status + bookkeeping_method pickers — auto-detect (vat_id checksum + revenue heuristic) or default to morshe + single_entry?
6. **IA:** with Businesses moving to header switcher, what's the empty state when user has 0 businesses (during onboarding)?
7. **Step-up payload-hash scope:** for invoice issuance, hash invoice header only or include all line items? (Performance vs precision trade-off.)
8. **DEK migration timing:** ship before Layer 3 (re-encrypt existing rows) or after (so Layer 3 ciphertext is born-envelope)?
