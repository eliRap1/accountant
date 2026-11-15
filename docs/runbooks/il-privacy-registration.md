# IL Privacy Authority Registration Runbook

> Status: planned. Decision to actually file is gated by the analysis in § 2
> (it is NOT automatic post-Amendment 13). This document captures both paths
> — registering and not registering — and the evidence trail we owe the
> regulator either way.

---

## 1. Why this exists

Israel's `Protection of Privacy Law, 5741-1981` (`חוק הגנת הפרטיות`) is
administered by the Privacy Protection Authority
(`הרשות להגנת הפרטיות` / PPA, sometimes "RGP" in older docs — the
acronym persisted from the prior "ILITA" name; current branding is "PPA").
The PPA maintains the database registry (`רישום מאגרי מידע`).

**Amendment 13** (`תיקון 13`) to the law took effect **August 14, 2025** and
fundamentally rewrote which databases must be registered, who must appoint a
DPO, and what the PPA can fine. Pre-Amendment-13 guidance circulating online
is stale — a 10,000-data-subject threshold was widely cited but the
Amendment narrowed registration to specific high-risk categories. Reading old
blog posts will lead to over-compliance theatre or, worse, missing a real
obligation. **Always re-verify against PPA primary sources before filing**.

Sources verified 2026-05-16:
- DLA Piper — Data Protection Laws of the World, Israel registration page:
  <https://www.dlapiperdataprotection.com/index.html?t=registration&c=IL>
- IAPP — overview of Amendment 13:
  <https://iapp.org/news/a/israel-marks-a-new-era-in-privacy-law-amendment-13-ushers-in-sweeping-reform>
- PPA department page:
  <https://www.gov.il/en/departments/the_privacy_protection_authority>
  (English) / `https://www.gov.il/he/Departments/the_privacy_protection_authority`
  (Hebrew). **The specific online-service slug for database registration
  could not be fetched on 2026-05-16 (`/he/service/database_registration`
  returned 403 to automated fetch). The portal path is `<verify-this>` —
  a human must visit the PPA department page above and find the active
  "submit a registration" link before filing.**

---

## 2. Do we need to register? Threshold + scope analysis

Per Amendment 13 (DLA Piper summary, fetched 2026-05-16; verbatim quotes
where useful):

A database **must** be registered if **any** of the following is true:

1. **It contains personal data on more than 10,000 data subjects AND its main
   purpose is the collection of personal data for the purpose of transferring
   to third parties, either for business purposes or in exchange for
   compensation.** This is the "data broker" / direct-marketing leg.
2. **The database controller is a Public Body** (with an exception for
   employee-only databases).
3. **Direct-marketing databases** (separate explicit registration trigger
   under Amendment 13).

**Where AccounTech sits today:**

- We hold personal data on Israeli self-employed users (name, email,
  encrypted tax ID, encrypted DOB, encrypted national_id, planned encrypted
  payroll salary, planned encrypted bank refs).
- Our purpose is **subscription accounting + tax-estimate SaaS** — not
  transferring data to third parties for compensation, not direct marketing,
  not a public body.
- We expect <10,000 IL users for at least the first 18-24 months; even if we
  cross that bar, criterion (1) requires *both* the volume AND the
  transfer-for-compensation purpose.

**Conclusion (subject to legal review):** Registration is **likely not
mandatory** for AccounTech under Amendment 13's narrowed scope. This is a
*material correction* to the older "register before 10k IL users" rule of
thumb that pre-Amendment-13 guidance pushed.

**`<legal-review-required>`** — confirm with an Israeli privacy-law
practitioner before deciding to skip. Two reasons:
- Whether storing tax IDs of self-employed (which are also national IDs in
  IL) crosses any *separate* threshold not surfaced in summary articles.
- Whether enabling the AI snapshot feature (which transmits derived
  financial context to an external AI provider) re-classifies the system
  under another trigger.

**Default if we don't register:** we still owe the PPA every other
Amendment-13 obligation (notification of breaches, data-subject rights, DPO
appointment if thresholds hit, processing records). Skipping registration ≠
skipping compliance. See § 5.

---

## 3. Timing — if/when we do register

- **File before the first paid user goes live in the relevant scope**, not
  before the first free signup. Free-tier users without payments still
  trigger personal-data processing, so the "before launch" window is
  effectively from the day we ship beyond closed-alpha.
- PPA response window (per public guidance): around **30 days** for review;
  the database may operate during the review period unless the PPA refuses.
- We do not need to wait for a registration certificate to ship — we just
  need our **application** submitted, and the data processing logged in our
  own records.
- Once filed, the registration is **annually reviewable** (see § 6).

---

## 4. Forms and portal links

**Department landing page (verified 2026-05-16):**
<https://www.gov.il/en/departments/the_privacy_protection_authority>

**Database registration online service slug:** `<verify-this>` — the
expected URL is `https://www.gov.il/he/service/database_registration` but
this returned HTTP 403 to automated fetch on 2026-05-16. Before filing, a
human must:

1. Open the PPA department page above.
2. Find the active "Registering a Database" / "רישום מאגר מידע" service
   tile.
3. Record the exact `gov.il` URL into this runbook (replace the
   `<verify-this>` block).

**Forms referenced in pre-Amendment-13 practice — `<verify-this>` whether
the names changed under the Amendment:**

- **Form 1 (`טופס 1`)** — Application for Registration of a Database
  (`בקשה לרישום מאגר מידע`). Identifies the controller, holder, purposes,
  data types, recipients, and security measures.
- **Form 2 (`טופס 2`)** — Notification of changes to an existing
  registered database.
- **Form 3 (`טופס 3`)** — Notification of cancellation of a registered
  database.

Older PPA practice required hard-copy + apostille for foreign-incorporated
controllers; under Amendment 13 the process is online. Confirm both the form
names and the submission channel are current before filing —
`<verify-this>`.

**Likely required attachments (`<verify-this>` against the live submission
form, since the form's required-attachment list is what governs):**

- Current Privacy Policy (we'll point at the deployed `/privacy` page).
- A **security plan** (`מסמך אבטחת מידע`) summarising controls. Plan v4
  already names the components we'd put in it (envelope encryption,
  AES-256-GCM with AAD, RLS roles `app_user` / `app_service`, Frankfurt EU
  region, MFA + passkeys, rate limiting, audit log). The PPA's regulations
  (`תקנות הגנת הפרטיות (אבטחת מידע), 2017`) classify databases by
  security tier (basic / medium / high) — we sit in **medium** at minimum
  because we hold national IDs; possibly **high** because of financial data
  volume. `<legal-review-required>` for the tier classification.
- DPO appointment letter, **if** Amendment 13 thresholds require a DPO. See
  § 5.

---

## 5. What the application will ask — checklist

Pre-draft the answers before opening the form. Fields below are from
pre-Amendment-13 form structure; the Amendment may have rearranged them but
the underlying questions persist.

| Field                        | Our answer (draft)                                                                                                                                                                                              |
|------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Database name                | "AccounTech Production Database" (or product name once locked).                                                                                                                                                  |
| Controller (`בעל המאגר`)   | Founding entity name — `<verify-this>` (LLC / Ltd. / sole proprietor — depends on the company structure decided pre-launch).                                                                                       |
| Holder (`מחזיק במאגר`)    | Same entity (Neon is a processor, not a holder — see PPA cross-border guidance).                                                                                                                                  |
| Manager (`מנהל מאגר`)     | Named natural person (founder by default).                                                                                                                                                                       |
| DPO appointed?               | `<legal-review-required>` — see § 5.1.                                                                                                                                                                            |
| Database purpose             | "Subscription accounting + tax-estimate SaaS for Israeli self-employed (עוסק פטור / מורשה / ח.פ.) and their accountants. Provides bookkeeping, invoicing, tax estimates, filings preparation."                  |
| Types of personal data held  | Email, name, locale; **encrypted** (AES-256-GCM, envelope): tax ID, national_id, date of birth; **planned encrypted**: bank account references, payroll salary (B2B context), processor API credentials.       |
| Sources of data              | Direct from the data subject (account signup, in-app entry, document upload).                                                                                                                                   |
| Recipients of data           | (a) The data subject themselves. (b) Optional AI provider for the AI snapshot feature, on a per-message opt-in basis, with a redacted derived context (no raw PII transmitted). (c) No third parties otherwise. |
| Cross-border transfer        | Yes — data stored on Neon Postgres + Vercel infrastructure in Frankfurt, Germany (EU). EU is on the PPA's adequacy list under the cross-border transfer regulations (`<verify-this>` adequacy reference).        |
| Security measures            | EU residency, AES-256-GCM envelope encryption with versioned KEK + per-row DEKs, RLS at DB layer, MFA + passkeys for users, audit log (`auth_events`) with 7-year retention, encrypted off-Neon backups.       |
| Retention period             | Active account: indefinite while subscription is active. Closed account: PII purged via DEK destruction on the soft-delete deadline (see Plan v4 Risk #7). Tax records retained 7 years per Income Tax Ordinance § 130 with PII cryptographically erased after closure. |
| Data subject rights process  | Right of access, correction, deletion — all routable via in-app self-service for PII held under envelope encryption; data export (machine-readable) provided on request.                                          |

### 5.1. DPO appointment

Per Amendment 13 (DLA Piper summary, 2026-05-16), a DPO is mandatory when
the controller:

1. Is a Public Body — N/A.
2. Operates as a data broker (10,000+ subjects + transfer-for-compensation
   model) — N/A under our model.
3. Conducts "regular and systematic monitoring of data subjects on a Large
   Scale" — borderline; the AI snapshot + bookkeeping cron analyses the user's
   own financial data, which is processing-on-behalf-of-subject, not
   monitoring-of-subject. **`<legal-review-required>`.**
4. Processes "Especially Sensitive Data on a Large Scale" —
   `<legal-review-required>`. Under the Amendment "especially sensitive"
   was expanded to include biometric / genetic / criminal / sexual
   orientation / financial details. Financial data inclusion is the question
   — does individual accounting data count? If yes AND we're "Large Scale"
   (the Amendment does not define the threshold numerically — courts
   will), we owe a DPO. Default conservatively: appoint a DPO once we
   pass ~500 paid users to give the lawyer something defensible to point at.

The DPO need not be a separate hire initially — the founder can serve as
DPO if they hold "in-depth knowledge in privacy protection laws". A formal
appointment letter + reporting line to senior management is required.

---

## 6. Annual review

- **Calendar reminder:** every 12 months, on the registration anniversary
  (or, if not registered, on the anniversary of when we *decided* not to
  register). Owner = whoever holds the compliance hat (initially founder).
- **What triggers an out-of-band update — must re-file Form 2 within a
  reasonable window:**
  - New data type collected (e.g. starting to store users' bank login
    cookies for OFX import).
  - New cross-border transfer (e.g. adding a US-based AI provider, since
    the EU adequacy decision doesn't cover the US directly).
  - New recipient (a new processor — Stripe at F.1, partner invoice
    provider at F.4, processor-sync vendors at F.4 — each is a
    notification, even if not a registration trigger on its own).
  - User count crossing thresholds that change DPO obligations.
  - Material change to security measures (e.g. KEK rotation procedure
    change, retention period change).
  - Change of controller / holder / manager identity.
- **What to keep — even if we don't register:** an internal "processing
  records" file (`docs/compliance/processing-records.md` — `<verify-this>`
  path; not yet created) that mirrors Form 1's fields. Amendment 13's
  records-of-processing obligation applies regardless of whether the database
  is on the registry. We owe this to ourselves for the next audit anyway.

---

## 7. How our schema satisfies what the PPA will ask

The PPA's two questions to any controller, in plain language, are:
**"How do you protect personal data?"** and **"How do you delete it when
asked?"** Plan v4 + the existing migration answer both.

### 7.1. Protection — envelope encryption + RLS

- **Storage layer**: every PII column (`tax_id_ciphertext`,
  `national_id_ciphertext`, `dob_ciphertext`, planned `bank_ref_ciphertext`,
  planned `payroll_salary_ciphertext`) is `bytea` holding AES-256-GCM
  ciphertext with AAD = `{table, column, rowId}` triple. Implementation:
  `lib/security/encryption.ts` (landed) — see Plan v4 § Locked Decisions
  "Encryption AAD".
- **Key management**: KEK lives in env var `DATA_ENCRYPTION_KEY`, 32 raw
  bytes, asserted at boot (`lib/security/kek.ts` + `lib/auth/selfTest.ts`).
  Per-row / per-purpose DEKs live wrapped in `data_encryption_keys` with
  `kek_version` + `retired_at` columns enabling KEK rotation without rewriting
  ciphertext rows (the wrapped DEK is rewrapped under the new KEK; the
  row data isn't touched). This is the "envelope encryption" pattern the
  Israeli information-security regulations (`תקנות אבטחת מידע 2017`) treat
  as state-of-the-art.
- **Access layer**: Postgres roles `app_user` (NOLOGIN) and `app_service`
  (NOLOGIN BYPASSRLS), installed by `db/migrations/0001_peaceful_maverick.sql`.
  Application queries go through `withUser(userId, tx => …)` which sets
  `LOCAL ROLE app_user` and `LOCAL "app.current_user_id"`; RLS policies on
  every PII-bearing table scope by that GUC. The service role is reserved
  for crons + admin reads of operational tables (`auth_events`,
  `rate_limit_buckets`, `data_encryption_keys`).
- **Auth layer**: Better Auth 1.6.x with TOTP + passkeys + email OTP +
  Cloudflare Turnstile (signup gate). Sensitive operations gate on a
  step-up freshness check (`requireFreshSession({op, payloadHash, maxAge:
  300})` — registry keyed by `{op, payloadHash}` so a step-up for "issue
  invoice X" doesn't authorise "issue invoice Y").

### 7.2. Deletion — soft-delete + DEK destruction (Plan v4 Risk #7)

This is the answer to PPA's "how do you handle a right-of-erasure request
when you also have a tax-record retention duty" — the two duties are
reconciled by **cryptographic erasure**:

1. On user-deletion request, the live PII columns are nulled in the
   foreground (UI shows "deleted" instantly).
2. The wrapped DEK row(s) for that user's PII purposes (e.g.
   `pii.user_dob`, `pii.payroll_salary` scoped to their business_id) are
   marked `retired_at = now()` in `data_encryption_keys`. The wrap key for
   those rows is then destroyed in the background (we overwrite the wrapped
   bytes with `\x00…`).
3. Tax records (`tax_filings`, `invoices`, `auth_events`) referencing the
   user remain in place to satisfy Income Tax Ordinance § 130 retention,
   but the encrypted columns inside them are now ciphertext-without-a-key —
   computationally equivalent to deletion.
4. After the 7-year retention window expires, a sweep purges the rows
   entirely.

This pattern is documented in Plan v4 § Risk #7 and earmarked for
`docs/adr/0008-deletion-policy.md` (not yet written).

### 7.3. Auditability

- `auth_events` table — sign-in, sign-out, MFA enroll, password change,
  suspicious IP, step-up grant, step-up denial, accountant-engagement-claimed,
  vat-status-transition. Service-role-read-only; retention aligned to the
  7-year tax-record window (Plan v4 Phase A.4). This is the "log" the PPA
  will ask for if they audit.

---

## 8. Quotable compliance bullets

Paste-ready for the Privacy Policy page, the registration application body,
and the regulator-facing one-pager. Each is honest to current code or to a
landed plan decision — none oversold.

- "Data is stored in the European Union (Frankfurt / `eu-central-1`) on
  Neon Postgres and Vercel Fluid Compute, both EU-adequacy-compliant under
  Israeli cross-border transfer regulations." `<verify-this>` adequacy
  citation against PPA's current adequacy list.
- "All personally identifying columns — including tax ID, national_id,
  date of birth, planned payroll salary and bank-account references — are
  stored as AES-256-GCM ciphertext with associated-data binding to
  `{table, column, row_id}` to defeat ciphertext shuffling."
- "Encryption uses envelope keys: a versioned key-encryption-key (KEK) wraps
  per-row data-encryption-keys (DEKs) stored in a dedicated table; the KEK
  never co-resides with the wrapped keys."
- "User deletion requests redact retained tax records via cryptographic
  erasure of the per-user DEK, reconciling the Israeli right-to-erasure with
  the seven-year retention duty under Income Tax Ordinance § 130."
- "Database-level role separation: application queries run under a
  Row-Level-Security-bound role with no privileged access; service
  operations run under a separate role and are logged to a 7-year audit
  trail."
- "Authentication requires email verification; users may additionally
  enable TOTP and/or passkeys (WebAuthn). Sensitive operations require a
  freshly re-authenticated session bound to the specific operation payload."
- "Backups are nightly, encrypted with the same envelope-encryption
  primitive as the live database, stored on a separate vendor (Vercel Blob
  private store), with 30-day rolling retention plus 7-year monthly
  snapshots."

---

## 9. What we are NOT claiming

Don't put any of these in the application or the public Privacy Policy —
they would be false today.

- **No ISO 27001 / SOC 2 certification.** We have neither. The Privacy Law
  doesn't require either, and overclaiming invites an audit we'd lose.
- **No "data never leaves Israel".** It does — Frankfurt is in the EU, not
  in Israel. Be explicit about the EU residency rather than vague about it.
- **No "fully GDPR-compliant" claim.** GDPR is a separate regime; we
  follow its principles but we are an Israeli entity governed by the
  Israeli Privacy Law. If we ever take EU-resident customers we revisit.
- **No "filing your tax returns for you" framing.** This is a tax-record
  product and a planning aid; the disclaimer banner stays on every tax
  surface (Plan v4 § Locked Decisions). Regulators reading our compliance
  materials should see this consistency.
- **No "we never read your data" claim.** Service-role queries can decrypt
  PII (that's the point of the service role) for legitimate ops — audit log
  scans, abuse investigations, support cases the user opens. Be honest
  about that capability and bound it with logging.
- **No claim to a DPO until we appoint one.** If we determine in § 5.1
  that we don't need one yet, write that decision down with a date and a
  reviewer, but don't claim DPO coverage to the regulator.

---

## 10. Open items requiring a human

- **`<legal-review-required>`** on the § 2 "do we need to register"
  conclusion — an Israeli privacy-law practitioner must sign off before we
  ship publicly.
- **`<legal-review-required>`** on whether financial accounting data
  qualifies as "Especially Sensitive Data on a Large Scale" under Amendment
  13 — determines the DPO trigger.
- **`<verify-this>`** on the active `gov.il/he/service/…` slug for the
  online database registration service. The PPA department page exists; the
  service path returned 403 to automated fetch on 2026-05-16. A human must
  paste the actual URL into this runbook before filing.
- **`<verify-this>`** on current Form 1 / Form 2 / Form 3 names and
  attachment requirements — these are pre-Amendment-13 names; under
  Amendment 13 the structure may have changed.
- **`<verify-this>`** on PPA's current EU adequacy list reference, before
  we cite it in the cross-border transfer answer.
- **`<verify-this>`** on the data security tier classification
  (basic / medium / high) under the 2017 information-security
  regulations; AccounTech is medium-or-high and the exact tier governs
  the controls we must document.

End of runbook.
