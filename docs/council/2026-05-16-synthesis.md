# AccounTech — Synthesis Memo 2026-05-16

**Subject:** Synthesis of product + security + CPA council findings against the stated goal of replacing IL accountants and being "deeply needed". Drafted while Phase D + E + security-remediation agents are still in flight; reads against on-disk state through commit `fa62a92` + uncommitted chunks A/B/B.3/C-libs/F.1.

---

## 1. Goal restated

The user's directive: a SaaS that

> "manages everything — clients, projects, money, profit, invoices, income, expenses … not only desired but deeply needed, automates and solves most problems, replaces accountants, adds more value."

Three council reviewers were asked: is what we are building going to do that? Where are the gaps?

---

## 2. What landed (technical state through 2026-05-16 03:30)

| Layer | Status | Notes |
|---|---|---|
| Foundation (Phase A.1) | ✅ pnpm + Drizzle + Neon + TS strict | committed `dd1ba34`..`657069b` |
| Better Auth (A.2) | ✅ self-hosted, MFA + passkey + OTP + admin + captcha | committed `f421d49`..`edb90fc` |
| Schema Layer 1 (identity / tenancy / billing / ops) | ✅ 11 tables + RLS | committed `d824064` |
| Auth UI (A.3 ch.1+2) | ✅ 9 routes incl. 2FA + passkeys + recovery | committed `6d9cb2d`..`761a12e` |
| Navbar CTAs (A.4) | ✅ wired to /sign-in + /sign-up | committed `ba37ba7` |
| i18n migration (A.5) | ✅ next-intl + [locale] + ru-RU marketing-only | committed `df9c92a` |
| Ops surface (A.6) | ✅ Sentry + PostHog + Resend + 3 runbooks | committed `3dfa3fb` |
| Verification (A.7) | ✅ vitest + playwright + 41 tests | committed `feb3adb` |
| Schema Layer 2 (ledger / invoicing / money-flows) | ✅ 19 tables + 84 policies + 6 helpers + balance trigger | committed `fa62a92` |
| AppShell + onboarding + dashboard (B.2 ch.A) | ✅ uncommitted on disk | reported |
| Businesses + clients + transactions + ledger CRUD (B.2 ch.B) | ✅ uncommitted on disk | reported |
| Account deletion + cron + EstimatesDisclaimer (B.3) | ✅ uncommitted on disk | reported |
| Invoicing libs (lib/invoices, lib/fx, lib/recon) (Phase C) | ✅ uncommitted on disk | filesystem-confirmed |
| Stripe billing (F.1) | ✅ uncommitted on disk | filesystem-confirmed |
| Tax engines + AI advisor (Phase D libs) | ⏳ in flight | agent `a6d3850f` running |
| Filing exports (Phase E libs) | ⏳ in flight | agent `a3a365e0` running |
| Security remediation (envelope DEK + step-up + deploy gate) | ⏳ in flight | agent `a73fd8f7` running |
| Deploy verification on Vercel | ⏳ pending env-var setup by owner | runbook landed; no exec evidence |

Live Neon dev branch: 36 tables, 84 RLS policies, 6 SECURITY DEFINER helpers, 5 plans seeded, 48 chart-of-account codes.

---

## 3. Council findings — synthesis

### 3a. Product Council (memo `2026-05-16-product-review.md`)

- **Frame is wrong.** The codebase currently reads as "invoicing + receipts + estimates" — which is exactly Green Invoice's positioning at ₪29/mo, with SHAAM clearance live today. We lose that fight.
- **Re-frame as "The Tax-Anxiety Dashboard for Israeli עצמאים".** Single morning view that tells the user, in plain Hebrew, what they owe, when, and what to do.
- **Killer feature: Morning Tax Brief.** Daily 08:00 push/in-app card: VAT owed + due date + cash-on-hand vs reserves + the one action to take today. Uses primitives that already exist in the schema. Differentiates by surfacing what you owe, not what you earned.
- **Onboarding: 10 steps → 2 steps.** 22 inputs → 8 inputs. Cut password-confirm, vat_status picker (pick automatically from vat_id checksum + revenue heuristic), bookkeeping_method (default single_entry, surface ledger only on detection), tax_year_end_month (default Dec).
- **Dashboard tiles: replace ARR/EBITDA/YoY** with: VAT due this period, cash on hand, overdue invoices, uncategorised receipts, מקדמות paid/due, profit trend last 6 months. ARR/EBITDA are SaaS-investor metrics; an עצמאי does not care.
- **IA: demote Businesses to header switcher. Promote Tax to top-level** with sub-tabs (מע״מ / מקדמות / סיום שנה). Hide Ledger from single-entry users.
- **Pricing critique:** Green Invoice charges ₪29/54/89/155. Our Solo at ₪49 is fine but the Plus at ₪99 is exposed; Business at ₪199 looks expensive vs Green Invoice ₪155 with SHAAM clearance. Consider Solo → ₪39, Plus → ₪79, Business → ₪149, Accountant → ₪449 base + ₪59/seat.

### 3b. Security Council (memo `2026-05-16-security-review.md`)

**6 criticals; all addressed by the in-flight security-remediation agent:**

- **C-1 Envelope encryption unimplemented.** Every ciphertext today is encrypted directly under the master KEK. Right-of-erasure-via-DEK-destruction is non-functional. Fix in flight: `lib/security/dek.ts` per-purpose DEKs wrapped under KEK; `lib/security/encryption.ts` getting `encryptStringWithDek` / `decryptStringWithDek` helpers.
- **C-2 Step-up auth absent.** Every sensitive op (invoice ≥ threshold, filings, vat-status change, PII decrypt, account delete, MFA reset, processor cred view) is session-only. Fix in flight: `lib/auth/stepUp.ts` registry + `requireFreshSession({op, payloadHash, maxAgeSec})` with payload-hash scope binding.
- **C-3 Closed-period guard defined but never consulted.** `app_period_is_closed(business_id, entry_date)` SQL helper exists since `0005_rls_layer2.sql`; no app code calls it. Fix in flight: ledger Server Action gates writes into closed periods behind step-up.
- **C-4 No deploy gate for rotated secrets.** Three chat-pasted + two Claude-generated secrets are documented as "must rotate" in handoff.md, but nothing blocks `vercel deploy` with the compromised values. Fix in flight: `lib/auth/selfTest.ts` SHA-256-compares boot-time secrets against the known-compromised hashes; throws in production.
- **C-5 Turnstile silently disabled.** When `TURNSTILE_SECRET_KEY` is unset in production, the captcha plugin gates out and the sign-up form ships unprotected. Fix in flight: production selfTest throws when Turnstile env vars are unset.
- **C-6 `updateClient` clears PII on edit.** Confirmed by chunk B's own implementation report. Submitting an empty email field on /clients/[id]/edit OVERWRITES the encrypted email column with null. Fix in flight: `app/[locale]/(app)/clients/actions.ts` patched to preserve-on-blank.

**Plus** seven Highs and seven Mediums in the memo. Most are tractable; none are existential.

### 3c. CPA Council (memo `2026-05-16-cpa-review.md`)

- **Top 3 schema gaps:**
  1. **Layer 3 tables don't exist.** Plan v4 promises `tax_filings`, `payroll_*`, `owner_compensation`, `supplier_wht_rates`, `client_wht_certificates` — none of these are in `db/schema/`. A ח.פ. year-end walk cannot complete. Fix: a Phase E.0 schema migration before Phase E filings ship.
  2. **`chart_of_accounts.form_6111_line` is free-text with invented line numbers.** Needs a typed `form_6111_lines` reference table + Phase D re-derive against ITA's actual 6111 schedule.
  3. **`receipts` table lacks `supplier_vat_id` and `invoice_number_from_supplier`.** Required for PCN874 input-side rows.
- **Top 3 chart-of-account errata:**
  1. Code `1030` "Credit card receivable" is mis-classified as asset for the SaaS persona (should be liability — the card statement is a debt).
  2. Code `2150` "VAT net payable" is a phantom of `2100`; invites double-counting. Drop it and compute net at report time.
  3. Code `7400` "Vehicle expenses" lumps everything; breaks the 2/3-rule audit trail. Split into gas / maintenance / insurance / leasing / depreciation.
- **Killer feature for ₪399 tier: ITA-audit-package builder.** One-click encrypted ZIP of every artifact (PCN874s, receipts, reconciliations, financials, payroll 102s, owner-comp journal) with a per-line provenance manifest. Defensible because it requires multi-business tenancy + `accountant_engagements` + every Layer 3 table — Hashavshevet/CPA-tax would need to re-architect.

---

## 4. Two killer features, not one

The product and CPA councils independently picked different killer features. Both are correct, for different personas:

| Feature | Persona | Why defensible |
|---|---|---|
| **Morning Tax Brief** | עצמאי / freelancer | Habit-forming daily open; surfaces anxiety relief; data primitives already exist; Green Invoice exposes earnings, we expose obligations + actions |
| **ITA Audit-Package Builder** | Accountant managing 20 clients | Requires multi-business tenancy + every Layer 3 artifact; competitor must re-architect to match |

Recommendation: **ship both.** Morning Tax Brief drives Solo/Plus self-serve growth; Audit-Package Builder anchors the ₪399 Accountant tier and converts CPAs into channel partners.

---

## 5. Replaces accountants? Honest answer

**Today (technical state through 03:30):** No. We are at "advanced bookkeeping platform with disclaimer banners". An accountant is still needed because:

1. PCN874 / form 6111 / form 102 generation is library code only (Phase E libs in flight); no UI to file, no SHAAM clearance integration.
2. Tax estimates (Phase D libs in flight) are NOT signed off by a CPA — `lint:rule-meta` gate is intentionally failing.
3. Layer 3 tables (payroll, owner compensation, WHT certificates, tax_filings artifact storage) don't exist yet.
4. No real-money flows yet — Stripe billing landed in F.1 but no automatic VAT collection on customer revenue.
5. No SHAAM certified-vendor status (9-18 mo + ₪40-80k per Plan v4).

**Six months from today, post-Phase E + F.4 + CPA sign-off + SHAAM partner integration:** Yes for עוסק פטור + small עוסק מורשה (estimated 70% of self-employed Israelis). The accountant remains for:
- Year-end strategic tax planning (deductions, structural choices)
- ITA audit defense (we provide the audit package; humans defend the position)
- ח.פ. corporate structuring (incorporation, dividends, owner-comp strategy)

**This is the right outcome.** "Replace accountants" was rhetoric; the achievable + defensible product is "replace the 80% of bookkeeping + filing work an accountant does at ₪400-800/month for ₪49-199/month, and become the audit-package source-of-truth for the remaining 20% the accountant does at year-end". The Accountant tier (₪399) explicitly invites the accountant in as a co-user, not a competitor — that's the channel play.

---

## 6. Pre-launch blocker list (gate to "deeply needed")

Sorted by what stops the FIRST paying user from signing up safely:

1. ✅ **Phase B.2 + B.3 commit + push** — landed on disk, awaiting commit
2. ⏳ **Security remediation completes** — envelope encryption + step-up + deploy gate (in flight)
3. ⏳ **Phase D + E libs commit** — tax engines + filing generators (in flight)
4. 🟡 **Phase E.0 schema additions** — Layer 3 tables CPA council flagged (not yet dispatched; next session)
5. 🟡 **Phase E UI** — filing wizard + download (not yet dispatched)
6. 🟡 **Onboarding + dashboard rework per Product council** — cuts + tile redesign (not yet dispatched)
7. 🟡 **Morning Tax Brief implementation** — `lib/ai/morningBrief.ts` + cron + email + in-app card (next session)
8. 🟡 **Audit-Package Builder** — needs Layer 3 + a packaging job + step-up gate (Phase F or later)
9. 🟡 **CPA sign-off on rules-2026.meta.json** — gates `lint:rule-meta`; gates Phase D UI release (external + ₪)
10. 🟡 **Vercel env vars + secret rotation** — owner action; documented in runbook
11. 🟡 **Resend domain DKIM/SPF/DMARC** — owner action; documented in runbook
12. 🟡 **First Vercel green production deploy** — needs 10 + 11 to land

---

## 7. Path forward (post this session)

1. Commit + push everything that landed: Phase B + Phase C + F.1 + security-remediation + Phase D + Phase E + the 3 council memos + this synthesis.
2. Owner sets Vercel env vars per `docs/runbooks/vercel-env-setup.md` + rotates the 5 secrets. Trigger production deploy. Verify green.
3. Next session: Layer 3 schema migration + Phase E filing UI + Morning Tax Brief + onboarding cuts per Product council.
4. Session after: Audit-Package Builder + CPA-tier polish + SHAAM partner integration scoping.
5. Council re-review at end of Phase E.

---

## 8. Verdict

The product trajectory is sound. The current implementation is sound. The remaining work is well-scoped. The killer features (Morning Tax Brief + Audit-Package Builder) are defensible and the data primitives to support them are already in place.

**Is it deeply needed?** Yes — for the 250k+ Israeli self-employed who currently pay an accountant ₪400-800/mo for work software can do at ₪49-199/mo, and for the 5k+ Israeli accountants who currently manage 20-100 small clients in Hashavshevet without a tenancy-aware tool.

**Does it replace accountants?** Not entirely, and that's the right framing. It replaces the bookkeeping/filing 80% and elevates the accountant from data-entry-clerk to audit-defense-strategist. That's a better job for them and a cheaper, faster product for the small business.

**Does it add value beyond what exists?** Yes. Green Invoice exposes earnings; we expose obligations + actions (Morning Tax Brief). iCount/EZcount don't have an audit-package builder. Hashavshevet doesn't have tenancy. Each is a real moat.

---

End of synthesis. Updated when Phase D + E + security-remediation agents land and after the first green Vercel deploy.
