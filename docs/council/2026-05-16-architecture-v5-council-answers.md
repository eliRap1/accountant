# Architecture v5 — Council Answers

**Date:** 2026-05-16
**Council voices:** Security + CPA + Product (unified)
**Scope:** Binding answers to the 8 open questions at the end of `2026-05-16-architecture-v5.md`. Implementation agents will read this file and act; they will NOT re-read the source council memos. Be opinionated.

---

## Q1. Layer 3 schema scope

> **Layer 3 schema scope:** ship all 15 tables at once or layered? If layered, what's the dependency order?

**Decision:** Ship all 15 tables in a **single migration `0007_schema_layer3.sql` + a paired `0008_rls_layer3.sql`**. One transaction, one deploy, no half-state.

**Rationale:**
- We have zero production users. The cost of "all or nothing" is zero now; it will be infinite after the first paying customer (multi-step migration across RLS-scoped tables = hours of locked writes if attempted later).
- Cross-table FKs are tight: `payroll_runs` references `payroll_employees`; `form_101_declarations` references `payroll_employees`; `audit_packages.manifest_jsonb` references every Layer 3 artifact table. Layering forces stub FKs or NULL-able placeholder columns that bake bad design.
- CPA council §2-3 says ח.פ. + עוסק-morshe year-end walks are **blocked** until Layer 3 lands. Filings UI (Phase E #5 in the impl order) cannot ship without `tax_filings`. Sequencing buys nothing.
- The 15-table set is internally consistent (every column already specced in Plan v4 and the architecture-v5 table). Reviewing 15 tables as one PR is also faster for the CPA reviewer than 5 separate reviews.

**Implementation hint:**
- Files: `db/schema/{tax-filings.ts,tax-advances.ts,payroll.ts,withholding.ts,owner-compensation.ts,risk-flags.ts,inventory.ts,audit-packages.ts,recurring-invoices.ts}.ts` (logical grouping; `payroll.ts` holds `payroll_employees`, `payroll_runs`, `form_101_declarations`, `pension_contributions`, `severance_provisions`). Re-export from `db/schema/index.ts`.
- Migration: `db/migrations/0007_schema_layer3.sql` (CREATE TABLE only); `0008_rls_layer3.sql` (ENABLE RLS + policies + GRANTs). Same SECURITY DEFINER helper pattern as Layer 2 (`app_user_can_access_business`). No new helpers needed — re-use existing.
- Edge case: `audit_packages.manifest_jsonb` should reference artifact rows by `{kind, id}` pairs, never raw UUIDs without a kind discriminator. A manifest that drops the discriminator becomes impossible to rebuild if a row is hard-deleted in a sibling table.
- Edge case: encrypted columns (`payroll_employees.national_id_ciphertext`, `payroll_employees.gross_monthly_minor_ciphertext`, `tax_filings.file_ciphertext`, `audit_packages.zip_blob_ciphertext`) need a `*_dek_id` UUID FK to `data_encryption_keys` per row (envelope encryption, not bare-KEK). Match the column shape `lib/security/dek.ts` writes.

---

## Q2. Morning Tax Brief delivery rules

> **Morning Tax Brief:** daily fire even if no new data? Skip weekends? Per-user quiet-hours setting? Email + push or in-app card only?

**Decision:** **Fire daily at 08:00 Asia/Jerusalem; skip Friday + Saturday (Israeli weekend); send email + in-app card; no push for v1; per-user opt-out only (no quiet-hours dial). Send only if the message has a non-trivial number — "no VAT due, no overdue invoices, no uncategorised receipts" = skip.**

**Rationale:**
- Israel's 2008 anti-spam law (Amendment 40 to the Communications Law) requires explicit consent for commercial email; there is **no statutory quiet-hours window**, but daily marketing-styled messages erode opt-in. Product council §7 ("habit-forming morning open") is contingent on the message having a non-zero signal — empty briefs train the user to filter the address.
- Friday + Saturday = Israeli weekend (most עצמאים do not open work email; many observant users will not). Sending on those days inflates unsubscribe rate without retention upside.
- Email + in-app card covers 100% of users. Web Push API on iOS Safari is gated to PWA-installed apps (>16.4); shipping it as Day-1 introduces a flow we'd have to also test in PWA mode. Defer push to F.5 per Product council §6.
- A quiet-hours dial sounds user-friendly but burns engineer-days on a TZ-with-DST permutation matrix for a setting <5% of users will touch. Opt-out is binary, ships in an hour, covers the actual concern ("stop emailing me").

**Implementation hint:**
- `lib/ai/morningBrief.ts` exports `composeBrief({userId, businessId, asOf}): Promise<{shouldSend: boolean, subject: string, bodyHe: string, bodyEn: string}>`. `shouldSend` is `true` only if at least one of (vatDueNextDeadline within 14d AND amount > 0) OR (overdueInvoices.count > 0) OR (uncategorisedReceipts.count >= 3) holds.
- `app/api/cron/morning-brief/route.ts` — gated by `CRON_SECRET`; iterates users with `morning_brief_opt_in = true` AND `email_verified_at IS NOT NULL`; computes business-local 08:00 (single TZ for v1 = `Asia/Jerusalem`); skips if `now().getDay() in (5,6)` (Fri=5, Sat=6 in JS Date); writes an `outbox` row + sends via Resend.
- Idempotency: `morning_briefs_sent(user_id uuid, business_id uuid, sent_for_date date, PRIMARY KEY (user_id, business_id, sent_for_date))` table; INSERT … ON CONFLICT DO NOTHING; if conflict, skip Resend call.
- Edge case: user's only business is brand-new (zero invoices, zero receipts) → `shouldSend = false`. Otherwise the first 5 mornings are guaranteed empty briefs and we churn them at intro.
- Edge case: if user is on the Free plan, cap brief at "VAT due" line only; AI follow-up disabled — Product council §7 monetisation hook.
- Settings UI: single toggle "סיכום בוקר יומי" / "Daily morning brief" on `/settings`. Default = ON for new users post-onboarding. Add a "Friday + Saturday" toggle later if users ask.

**Dissent:** Product council §7 leans toward "push notifications as the habit-anchor"; we chose email+card for v1 because push requires PWA-install which we don't have. Revisit at F.5 when PWA lands.

---

## Q3. Audit Package Builder — authority & DEK scope

> **Audit Package Builder:** who can trigger — owner only, or also any `accountant_engagement.role = 'accountant'`? Per-package DEK or per-business?

**Decision:** **Owner (always) + accountant engagement with `scopes_jsonb.filings = true` AND `scopes_jsonb.ledger = true` AND `acceptedAt IS NOT NULL` AND `revokedAt IS NULL`. Step-up gated on every build. Per-package DEK (one DEK per `audit_packages` row), retired when the package is deleted.**

**Rationale:**
- Under IL practice an accountant prepares filings; the owner authorizes submission. An audit-package is a *preparation artifact* (collation of underlying records for an inspector visit), not a submission — so a properly-scoped accountant generating it is well within standard practice. But it bundles every receipt + every owner-compensation entry → not every "accountant"-tier engagement should have it. Gating on `scopes_jsonb.filings && scopes_jsonb.ledger` is the right discriminator; an engagement with `ai: true` only should NOT build packages.
- Security council M-4 flagged that current RLS policies ignore `scopes_jsonb`; this is the first place we MUST honor them. If the gate isn't here, the field is decorative.
- Per-package DEK is mandatory for crypto-erasure: when a user deletes an audit package (e.g. typo, regenerated), the ZIP bytes in Vercel Blob may have already been downloaded by the accountant; retiring the DEK makes those bytes unrecoverable. A per-business DEK shared across packages cannot be retired without nuking every other package.
- Step-up at build time (not download time): the build is the moment that touches decrypted PII across multiple tables. Download merely streams an opaque ciphertext blob.

**Implementation hint:**
- `lib/audit/packageBuilder.ts` exports `buildAuditPackage({businessId, periodStart, periodEnd, actorUserId}): Promise<{packageId, blobUrl, manifestSha256}>`. First line of function: call `requireFreshSession({op: "filing.export_pcn874", payloadHash: computePayloadHash({businessId, periodStart, periodEnd, action: "audit_package"}), maxAgeSec: 300})` — re-use the existing `filing.export_pcn874` op (add a new dedicated op `audit.build_package` to `lib/auth/stepUp.ts`'s `STEP_UP_OPS` registry).
- Authority check (BEFORE step-up): `assertCanBuildAuditPackage(actorUserId, businessId)` resolves to true if (a) `businesses.owner_user_id = actorUserId`, OR (b) an `accountant_engagements` row exists matching the business + actor + `accepted_at IS NOT NULL` AND `revoked_at IS NULL` AND `(scopes_jsonb->>'filings')::bool IS TRUE AND (scopes_jsonb->>'ledger')::bool IS TRUE`. Reject otherwise with `403`.
- DEK lifecycle: `generateDek("audit_package:${packageId}")` at build start; encrypt ZIP bytes under that DEK; store `dek_id` on the `audit_packages` row. Hard-delete of the row → `retireDek(dekId, "audit package deleted")`.
- Manifest: `manifest_jsonb` contains `{artifactCount, sourceRowIds: [{kind, id}], generatedAt, actorUserId, periodStart, periodEnd, sha256OfPlaintextZip}`. The sha256 lets the recipient verify integrity without our help.
- Edge case: if owner deletes the business mid-build, the build's encryption-then-write may race the `ON DELETE CASCADE`. Wrap the build in a `SELECT … FOR UPDATE` on `businesses.id` for the duration of the transaction; if not found, fail.

**Dissent:** CPA council §8 implies accountants are the **primary** users of this feature ("Israeli CPAs servicing 20+ small clients lose 2-4 hours per ITA visit"). Product council §8 agrees. If owner sign-off becomes a bottleneck during ITA visits, revisit: owner could *delegate* the build right per engagement via a separate `scopes_jsonb.audit_packages: true` boolean. Flag this as **OWNER REVIEW** before code lands — the question is whether `scopes_jsonb.filings && ledger` is too broad or too narrow.

---

## Q4. CoA errata surfacing

> **CoA errata:** silent fix (migration alters seed) or surface to existing users via a one-time review modal?

**Decision:** **Silent fix in `0009_coa_fixes.sql` — alter the seed standard codes only (where `business_id IS NULL`). For any business-scoped codes (where `business_id IS NOT NULL`) that point at affected codes, do NOT mutate; instead write a row to a new `coa_errata_notices(business_id, code, prior_classification, new_classification, surfaced_at)` table. Surface a single dismissable banner on `/settings/chart-of-accounts` for the business owner — NOT a modal blocking dashboard load.**

**Rationale:**
- We have zero production users (per synthesis §2). The "silent fix to seed" half of the decision is therefore costless today; revisiting in 6 months when 100s of businesses exist would require reconciling user-customised CoA. Do it now while the cost is zero.
- For the 3 errata flagged: codes 1030 (asset→liability), 2150 (drop entirely), 7400 (split into 5). Code 1030 is the only one that's a *classification* change that could mis-state prior reports if a business has live transactions on it. Hence the per-business `coa_errata_notices` row — so the future-first-user who imported pre-fix sees a banner.
- Modal-blocking-dashboard is hostile UX for a problem 99% of users will never see. Banner on the settings page is the right scale.
- Legal: under IL Income Tax Ordinance § 130 bookkeeping rules, classification corrections are routine; the obligation is to document the change, not to interrupt. The notices table IS the documentation.

**Implementation hint:**
- Migration `db/migrations/0009_coa_fixes.sql`:
  - `UPDATE chart_of_accounts SET account_type = 'liability', name_en = 'Credit card clearing', name_he = '...' WHERE business_id IS NULL AND code = '1030';`
  - `DELETE FROM chart_of_accounts WHERE business_id IS NULL AND code = '2150';` (Safe: standard only; business-scoped 2150 stays.)
  - For 7400: keep the parent, INSERT 7401-7405 sub-codes, DO NOT delete 7400 (existing references may still point to it).
  - `CREATE TABLE coa_errata_notices ( … )` with RLS scope = business.
  - `INSERT INTO coa_errata_notices` for every business that has a `journal_lines.account_code IN ('1030','2150','7400')` row — write the notice. This is the join-write under service role.
- UI: `app/[locale]/(app)/settings/chart-of-accounts/page.tsx` renders any unread `coa_errata_notices` rows for the business as a yellow dismissable banner. "Dismiss" stamps `surfaced_at`.
- Edge case: if `journal_lines` already has rows posted with `account_code = '2150'`, the migration must NOT orphan them. Reassign them to `2100` in the same migration with an `app_journal_metadata_jsonb` annotation `{coa_errata_reassigned_from: "2150"}`.
- `scripts/db-seed.ts` must be updated in the same PR so re-seeding a dev DB doesn't recreate the broken codes.

---

## Q5. Onboarding `vat_status` + `bookkeeping_method` defaults

> **Onboarding cuts:** dropping vat_status + bookkeeping_method pickers — auto-detect (vat_id checksum + revenue heuristic) or default to morshe + single_entry?

**Decision:** **Default to `vat_status = osek_morshe` + `bookkeeping_method = single_entry` for `entity_type ∈ {patur, morshe, shutfut, amuta}`; default to `osek_morshe` + `double_entry` for `entity_type = hevra_baam`. Do NOT auto-detect from VAT-ID checksum or revenue (we don't have revenue at sign-up). Surface a "Wrong? Change it" link in settings.**

**Rationale:**
- VAT-ID checksum determines whether the ID is a 9-digit ע.מ. (עוסק / freelancer) or a 9-digit ח.פ. (חברה / company). It does NOT distinguish patur from morshe (both can be ע.מ.). So checksum-based auto-detect for `vat_status` is impossible.
- The עוסק-patur cap (`<inherited-verify 2026-05-16>` ~₪107k/yr) only matters at year-end. New users mostly self-classify as `morshe` and downgrade later if revenue stays low. The reverse mistake (`patur` user picks `morshe`) costs them more in VAT compliance overhead — so the safer default is `morshe`.
- `bookkeeping_method`: IL Income Tax Ordinance "ניהול ספרים תקין" rules force double-entry for ח.פ.; single-entry is the default for עצמאים and acceptable for עוסק-morshe under most revenue thresholds. Tying it to `entity_type` is mechanical and correct.
- Product council §2 cut #3 (collapse the 3 pickers into a single "מה סוג העסק?" with 3 cards) is the right UX. This decision says: under the hood, those 3 cards map to the (entityType, vatStatus, bookkeepingMethod) triple deterministically.

**Implementation hint:**
- `lib/businesses/defaults.ts` (or wherever `defaultsFor()` already lives — surface from Phase B): `function defaultsFor(entityType: EntityType): { vatStatus: VatStatus, bookkeepingMethod: BookkeepingMethod }`. Map:
  - `patur` → `(osek_patur, single_entry)` — note: עוסק-patur is the matching VAT status here, NOT osek_morshe.
  - `morshe` → `(osek_morshe, single_entry)`
  - `shutfut` → `(osek_morshe, single_entry)`
  - `amuta` → `(nonprofit, double_entry)`
  - `hevra_baam` → `(osek_morshe, double_entry)`
- Onboarding step 2 form: takes (legalName, vatId, city) + 3 cards (פטור / מורשה / חברה). Maps פטור→patur, מורשה→morshe, חברה→hevra_baam. amuta + shutfut deferred to a "more types" disclosure that 95% of users won't expand.
- Edge case: if user picks "פטור" and later their revenue exceeds the cap, surface a one-time banner "מתקרב לתקרת עוסק פטור — שדרג לעוסק מורשה" (Settings UI, not blocking). This is a Phase D/E future ticket.
- Edge case: a `patur` user who attempts to issue a `tax_invoice` (חשבונית מס) must be blocked — patur can only issue `receipt` (קבלה). Enforce in `lib/invoices/*` at the type-picker level, not at submit.

---

## Q6. Empty state for header business switcher

> **IA:** with Businesses moving to header switcher, what's the empty state when user has 0 businesses (during onboarding)?

**Decision:** **The switcher renders a single non-interactive label "ללא עסק" / "No business" and the `(app)` layout redirects to `/onboarding/business` if `businesses.length = 0` AND the route is NOT already `/onboarding/*`. Onboarding is the only writable state in zero-business mode.**

**Rationale:**
- After Product council's onboarding cut to 2 steps, the only state where a verified user has zero businesses is the few seconds between `/sign-up` success and the `/onboarding/business` form submit. We don't need a "create your first business" CTA in the switcher — we need a hard redirect.
- A dropdown that shows "no businesses, click to create" is a maze (user can dismiss it, get back to dashboard, hit "Add receipt" → 500 because there's no business context). A redirect at the layout level is one place, one check, one outcome.
- Accountant-tier engagements: if the user has ZERO owned businesses but HAS accepted engagements (`accountant_engagements` rows), the switcher shows those instead and the redirect does NOT fire. This is the unusual but real path of "I'm an accountant signed up to manage clients, I never owned a business."

**Implementation hint:**
- `app/[locale]/(app)/layout.tsx`: server-side resolve `const ctx = await loadBusinessContext(userId)`. If `ctx.ownedBusinesses.length === 0 && ctx.engagedBusinesses.length === 0`, redirect to `/${locale}/onboarding/business`. Otherwise render the shell.
- `components/app/BusinessSwitcher.tsx`: prop `businesses: Array<{id, legalName, kind: 'owned' | 'engaged'}>`. If empty, render a static disabled label; do NOT render a chevron or click handler.
- `lib/businesses/loadBusinessContext.ts` returns both arrays; cached per-request via React `cache()`.
- Edge case: user has 1 owned business, soft-deletes it (sets `deleted_at`). They should be treated as zero-business → redirect to onboarding. Filter `deleted_at IS NULL` in the resolver.
- Edge case: accountant claims an engagement but `acceptedAt IS NULL`. Treat as zero — surface the accept flow first.

---

## Q7. Step-up payload-hash scope for invoice issuance

> **Step-up payload-hash scope:** for invoice issuance, hash invoice header only or include all line items? (Performance vs precision trade-off.)

**Decision:** **Hash a canonical "header + line-total digest" tuple: `{business_id, invoice_type, sequential_number_attempt, total_minor, vat_minor, issue_date, client_id, currency, line_items_sha256}` where `line_items_sha256` is a deterministic hash of the line-items array (sorted by line_no). NOT the full line items inline.**

**Rationale:**
- The step-up grant must bind to the *invariant* of what the user authorized. If the attacker can swap a line item between grant-time and submit-time, the grant is forgeable. So line items MUST be in the binding.
- Including the full line-items array inline as the payload would (a) bloat the canonical-JSON SHA-256 on long invoices and (b) leak line-item structure into `auth_events.metadata_jsonb` which is service-role-readable. Hashing the array to a 64-char hex digest folds in the invariant without leaking content.
- `lib/auth/stepUp.ts:computePayloadHash` already does canonical-JSON sort. Adding a precomputed `line_items_sha256` field that itself is a SHA-256 of the same canonical-JSON of the line items array gives us a 2-layer binding: the outer hash binds the header + the inner hash; the inner hash binds the line items.
- `total_minor` + `vat_minor` are derived from line items, so they catch *most* tampering. `line_items_sha256` catches the residual cases (re-labeling line descriptions, splitting one line into two with identical totals, swapping client_id without changing total).

**Implementation hint:**
- `lib/invoices/stepUpPayload.ts` exports `computeInvoiceStepUpHash(input: InvoiceDraft): { payloadHash: string, payload: object }`. Internal flow:
  ```ts
  const lineItemsCanonical = input.lineItems
    .slice().sort((a,b) => a.lineNo - b.lineNo)
    .map(li => ({ lineNo: li.lineNo, description: li.description, quantity: li.quantity, unitPriceMinor: li.unitPriceMinor, vatRate: li.vatRate, totalMinor: li.totalMinor }));
  const lineItemsSha = crypto.createHash("sha256").update(JSON.stringify(lineItemsCanonical), "utf8").digest("hex");
  const payload = {
    business_id: input.businessId,
    invoice_type: input.invoiceType,
    sequential_number_attempt: input.sequentialNumberAttempt,
    total_minor: input.totalMinor,
    vat_minor: input.vatMinor,
    issue_date: input.issueDate, // YYYY-MM-DD
    client_id: input.clientId,
    currency: input.currency,
    line_items_sha256: lineItemsSha,
  };
  return { payloadHash: computePayloadHash(payload), payload };
  ```
- Use this hash in BOTH the step-up grant request AND the `requireFreshSession` check at issue time. Same function, same inputs.
- Edge case: `sequential_number_attempt` is the number the server is about to claim; if the claim races and the server has to advance (gap-fill via `invoice_sequence_audit`), the bound hash diverges → re-prompt step-up. This is acceptable for high-value invoices (rare) and correct from a security standpoint.
- Edge case: a draft re-edited between step-up grant and submit → totals likely change → hash diverges → re-prompt. Correct behavior; surface to user as "amount changed, please re-verify" not "step-up expired".
- Threshold for triggering this gate: `total_minor >= activeThresholdMinor()` where `activeThresholdMinor` reads from `lib/tax/il/rules-2026.ts:allocationThreshold` and is currently ₪10k (from 2026-06-01: ₪5k pre-VAT, per `<inherited-verify 2026-05-16>`).

---

## Q8. DEK migration timing

> **DEK migration timing:** ship before Layer 3 (re-encrypt existing rows) or after (so Layer 3 ciphertext is born-envelope)?

**Decision:** **Ship DEK migration FIRST (before Layer 3). Re-encrypt all existing ciphertext columns under purpose-scoped DEKs in migration `0006_dek_migration.sql`, THEN Layer 3 lands at `0007` with `*_ciphertext + *_dek_id` columns from the jump.**

**Rationale:**
- Layer 3 introduces 5+ new encrypted columns (`payroll_employees.national_id_ciphertext`, `payroll_employees.gross_monthly_minor_ciphertext`, `tax_filings.file_ciphertext`, `audit_packages.zip_blob_ciphertext`, `owner_compensation.notes_ciphertext`). If Layer 3 ships before DEK migration, those columns are born under bare-KEK and will need their own re-encrypt pass later — doubling the migration risk.
- `lib/security/dek.ts` is already shipped and tested per security council notes. The infrastructure is ready; only the call-site migration of Phase A+B ciphertext columns is missing.
- Today the codebase has ZERO production users. The re-encrypt pass touches ~6 columns × 0 rows = no-op in prod. In dev it touches whatever's in the test DB. Cost is effectively a schema change + a backfill script that runs in O(seconds).
- Security council C-1 calls this out as Critical-status. Synthesis §6 lists "DEK migration" as a remaining blocker.

**Implementation hint:**
- Migration `db/migrations/0006_dek_migration.sql`:
  1. `ALTER TABLE clients ADD COLUMN email_dek_id UUID REFERENCES data_encryption_keys(id);` (same for phone, notes).
  2. `ALTER TABLE users ADD COLUMN dob_dek_id UUID REFERENCES data_encryption_keys(id);` (same for national_id).
  3. `ALTER TABLE receipts ADD COLUMN ocr_text_dek_id UUID REFERENCES data_encryption_keys(id);`
  4. `ALTER TABLE processor_sync_credentials ADD COLUMN api_key_dek_id UUID REFERENCES data_encryption_keys(id);`
  5. CHECK constraint: `ciphertext IS NULL = dek_id IS NULL` (paired NULLability).
- Backfill script `scripts/db-dek-migrate.ts` (run inside the migration step or as a post-migration job):
  - For each table with ciphertext rows: read ciphertext → decrypt under bare KEK → `getOrCreateActiveDek(purpose)` where purpose = `business:${businessId}:client_contact` (or matching pattern from Plan v4) → encrypt under DEK → UPDATE both `ciphertext` (new AAD-bound bytes) and `dek_id` columns in same transaction.
  - Wrap in `withServiceRole` (bypass RLS for the bulk pass).
  - Idempotent: skip rows where `dek_id IS NOT NULL`.
- Application call sites (`app/[locale]/(app)/clients/actions.ts`, `app/[locale]/(app)/businesses/actions.ts`, etc.) switch from `encryptStringWithKey(getKek(), ...)` to a new `encryptColumn({purpose, plaintext, aad}): {ciphertext, dekId}` helper that calls `getOrCreateActiveDek(purpose)` internally and returns both bytes and dek_id for the caller to INSERT/UPDATE atomically.
- Edge case: the same `purpose` may collide on the partial-unique-index race; `getOrCreateActiveDek` already handles this (security council code reads correctly). Don't re-implement.
- Edge case: `account-purge` cron expects DEKs keyed `user:<appUserId>:%`. The migration must use this exact prefix shape for user-PII columns (`users.dob_ciphertext`, `users.national_id_ciphertext`) — purpose = `user:${appUserId}:pii`.
- Layer 3 (`0007`) then ships its encrypted columns with `*_ciphertext` + `*_dek_id` from birth. No second migration ever needed.

**Dissent:** None. Security council, CPA council, and Product council all agree DEK-first is correct; the only argument for "DEK after Layer 3" would be schedule pressure, and synthesis §6 confirms we don't have schedule pressure on a zero-user codebase.

---

## Summary table for the implementation agents

| Q | Decision (one-liner) |
|---|---|
| 1 | Ship all 15 Layer 3 tables in one migration `0007` + RLS `0008`. |
| 2 | Daily 08:00 Asia/Jerusalem, skip Fri+Sat, email+card only, opt-out toggle, skip empty briefs. |
| 3 | Owner OR engagement with `filings && ledger` scopes; step-up gated; per-package DEK. |
| 4 | Silent migration of seed CoA in `0009`; per-business `coa_errata_notices` row + banner on settings page. |
| 5 | Default `vat_status`/`bookkeeping_method` from `entity_type` deterministically; no auto-detect. |
| 6 | Zero-business state = layout-level redirect to `/onboarding/business`; switcher renders static label. |
| 7 | Hash header + `line_items_sha256` (digest of canonical line items); not full line items inline. |
| 8 | DEK migration FIRST (`0006`), Layer 3 SECOND (`0007`). |

## Items flagged for **OWNER REVIEW** before code lands

- **Q3 dissent:** is `scopes_jsonb.filings && scopes_jsonb.ledger` the right gate for audit-package authority, or should we add a dedicated `scopes_jsonb.audit_packages: true` boolean? CPA council leans toward broader accountant access; security council leans toward narrower. Owner should pick before the `lib/audit/packageBuilder.ts` author writes the `assertCanBuildAuditPackage` helper.

All other decisions are owner-implicit (they follow directly from the three council memos + the synthesis); implementation agents may proceed without further sign-off.
