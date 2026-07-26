# Email Deliverability Runbook — Resend + Better Auth

This runbook covers landing transactional mail (verification, password reset, MFA notifications) in the inbox via Resend for the AccounTech SaaS. Read this end-to-end before flipping `D:\accountant\lib\auth\better.ts` from `console.info(...)` to real Resend sends.

Throughout, `<your-domain>` is the sending domain (final value TBD). For send-only setups, prefer a sub-domain such as `mail.<your-domain>` to isolate reputation from the apex.

---

## 1. Resend domain setup checklist

Resend issues per-domain DNS records on the dashboard. Resend uses the AWS SES SMTP relay under the hood, so the exact MX value and SPF `include:` host are **regionally generated** and shown only after you add the domain. Copy them from the dashboard verbatim — do not invent values.

### 1.1. Add the domain in Resend

1. Log in at https://resend.com/domains.
2. Click **Add Domain**.
3. Enter `<your-domain>` (or `mail.<your-domain>` for a send-only sub-domain — recommended).
4. Select region. Pick the region closest to majority recipients (EU users → `eu-west-1`). The region determines the MX and SPF values you receive.
5. Click **Add**. Resend now shows a DNS records panel.

### 1.2. Records Resend will display

| Type | Host / Name | Value (pattern — copy actual from dashboard) | Purpose |
|---|---|---|---|
| MX  | `send.<your-domain>` (priority 10) | `feedback-smtp.<region>.amazonses.com` | Bounce + complaint feedback path |
| TXT | `send.<your-domain>` | `v=spf1 include:amazonses.com ~all` | SPF for the bounce sub-domain |
| TXT | `resend._domainkey.<your-domain>` | `p=MIGfMA0GCSq…` (2048-bit RSA public key) | DKIM signing |

Notes:
- DKIM selector is **`resend`**. If you also have other senders signing with the same selector, ask Resend to issue a custom selector.
- Resend has historically issued **1024-bit DKIM keys** by default on older accounts. **Demand 2048-bit** during setup — check the public key length in the dashboard. If only `p=` of ~216 chars is shown, that's 1024-bit. 2048-bit is ~392 chars. Delete and re-add the domain if you got a 1024-bit key.
- The SPF record above protects `send.<your-domain>` (the Return-Path / bounce domain). For DMARC alignment, see section 2.

### 1.3. Add the DMARC record yourself

Resend does **not** auto-generate DMARC. Add this TXT record at `_dmarc.<your-domain>` — see exact stage values in section 2.

### 1.4. Verify

1. Wait 5–60 minutes for DNS propagation (longer if your registrar is slow — Israeli registrars like Domain The Net Technologies can take up to 4 h).
2. In Resend dashboard, click **Verify DNS Records**.
3. All three rows (MX, SPF, DKIM) must show green **Verified**.
4. Sanity-check from the command line (PowerShell):
   ```powershell
   Resolve-DnsName -Type TXT  send.<your-domain>
   Resolve-DnsName -Type TXT  resend._domainkey.<your-domain>
   Resolve-DnsName -Type MX   send.<your-domain>
   Resolve-DnsName -Type TXT  _dmarc.<your-domain>
   ```
   Or via dig (WSL/git-bash):
   ```bash
   dig +short TXT send.<your-domain>
   dig +short TXT resend._domainkey.<your-domain>
   dig +short MX  send.<your-domain>
   dig +short TXT _dmarc.<your-domain>
   ```
5. Send a test email from Resend's **Send Test Email** UI to a Gmail address. Open the message → "Show original" → confirm `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.

---

## 2. DMARC policy progression

Three stages. Move forward only when you have **zero unaligned failures** in DMARC aggregate reports.

### Stage 1 — Monitor (days 0–14)

TXT record at `_dmarc.<your-domain>`:

```
v=DMARC1; p=none; rua=mailto:dmarc-reports@<your-domain>; ruf=mailto:dmarc-reports@<your-domain>; fo=1; adkim=s; aspf=s; pct=100
```

- `p=none` — no enforcement, gather reports only.
- `adkim=s` and `aspf=s` — **strict** alignment (organization-only match). This catches sub-domain leakage early. If reports show legitimate sub-domain sends, relax to `r` (relaxed) per-axis, do not stay at strict if it would block real mail.
- `rua` = aggregate XML reports (daily, from receivers). Use a mailbox you actually read or pipe into a parser like Postmark's DMARC Digests / dmarcian.
- `ruf` = per-message forensic reports. Many receivers (Gmail) won't send these — leave it; harmless.
- `fo=1` — request a forensic report on **any** alignment failure (not just full DMARC fail).

### Stage 2 — Quarantine (days 15–44)

After 2 clean weeks (no legit mail failing alignment):

```
v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc-reports@<your-domain>; ruf=mailto:dmarc-reports@<your-domain>; adkim=s; aspf=s
```

- Start at `pct=25` (only 25 % of failing mail goes to spam). Watch reports for 1 week, then raise to `pct=100`.

### Stage 3 — Reject (day 45+)

After 30 days of clean reports across both prior stages:

```
v=DMARC1; p=reject; rua=mailto:dmarc-reports@<your-domain>; adkim=s; aspf=s
```

- No `pct=` needed (defaults to 100).
- `ruf` dropped — forensic noise is rarely actionable at this point and may contain PII.

### Sub-domain policy

If you only send from `mail.<your-domain>`, add `sp=reject` to the apex DMARC once stage 3 is reached, so attackers can't forge `apex@<your-domain>`:

```
v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc-reports@<your-domain>
```

---

## 3. From-address conventions

| Use case | From address | Reply-To | Notes |
|---|---|---|---|
| Email verification (Better Auth `sendVerificationEmail`) | `verify@<your-domain>` | `support@<your-domain>` | Display name: `AccounTech Verification` |
| Password reset, MFA enrollment / disable alerts | `security@<your-domain>` | `support@<your-domain>` | Display name: `AccounTech Security` |
| All other user-facing mail (welcome, receipts, broadcasts) | `support@<your-domain>` | `support@<your-domain>` | Display name: `AccounTech Support` |

Hard rules:
- **`no-reply@<your-domain>` is forbidden.** Gmail and Outlook both demote `no-reply` senders — users mark them spam more often because they can't opt out conversationally. Engagement signals (opens, replies, "Not spam" clicks) are the strongest deliverability lever; killing replies kills the signal.
- **Reply-To is always `support@<your-domain>`.** A user who hits Reply on a `verify@` email lands at a monitored mailbox, not a black hole.
- **Display names matter.** Israeli users specifically distrust bare addresses. Use a real-looking sender, e.g.
  `AccounTech | אבטחה <security@<your-domain>>`.

For Better Auth, set this in the email hook config (next session — not in scope here).

---

## 4. Bounce + complaint webhook handling

### 4.1. Resend webhook events

Resend emits a single bounce event with a sub-type field rather than separate hard/soft events:

| Event | Meaning |
|---|---|
| `email.delivered` | SMTP 250 from recipient MX. |
| `email.bounced` | Permanent or transient failure. Inspect `data.bounce.type` (`Permanent` / `Transient`) and `data.bounce.subType` (`General`, `NoEmail`, `Suppressed`, `MailboxFull`, etc.). |
| `email.complained` | Recipient hit "report spam" (Feedback Loop). |
| `email.delivery_delayed` | Transient retrying — informational only. |

### 4.2. Webhook endpoint

- URL: `https://<your-domain>/api/webhooks/resend`
- Method: `POST`
- Verification: Resend signs payloads via Svix. Verify `svix-id`, `svix-timestamp`, `svix-signature` headers against the endpoint secret from the dashboard. Reject any request that fails signature verification with **401**. (Next session implements the route — this runbook just nails the contract.)

### 4.3. Handling rules

- `email.bounced` with `bounce.type === "Permanent"` → **hard bounce**.
  - Set `user.email_invalid = true` immediately.
  - Do **not** attempt resends. Better Auth must short-circuit `sendVerificationEmail` / `sendResetPassword` when `email_invalid` is true.
  - Log `bounce.subType` for ops triage (`NoEmail` is a typo; `Suppressed` means we already burned this address).
- `email.bounced` with `bounce.type === "Transient"` → **soft bounce**.
  - Increment `user.soft_bounce_count`.
  - If `soft_bounce_count >= 5` within 72 h, escalate to `email_invalid = true`.
  - Otherwise rely on Resend's internal retry (it handles 4xx backoff for ~72 h).
- `email.complained` → **complaint**.
  - Set `user.status = "ban_pending"` for manual review.
  - Suppress all further mail to that address (`email_suppressed = true`).
  - Do **not** auto-delete the account — complaints are sometimes mis-clicks; product/legal reviews.

### 4.4. Suppression list sync

Resend maintains its own suppression list once it sees a bounce, but we still mirror to our DB so:
- Sign-up flow can reject re-registration with a known-bad address.
- Better Auth doesn't keep generating verification tokens that will fail to send.
- We can show the user a "Your email bounced — update it" banner.

---

## 5. Israel-specific considerations

### 5.1. Hebrew content

- UTF-8 with **quoted-printable** or **base64** transfer encoding is mandatory for non-ASCII subject lines. Resend's Node SDK handles this automatically when you pass UTF-8 strings — do not pre-encode.
- RFC 2047 encoded-word subjects (`=?UTF-8?B?…?=`) are fine. Resend emits them when needed.
- Keep subject lines **under 70 visual chars** — Hebrew is wider per char in many clients and gets truncated badly on mobile.

### 5.2. Picky Israeli ISPs

These domains historically fail mail that passes SPF/DKIM but fails **alignment** (i.e. SPF from one domain, From: header from another):

- `@walla.co.il` — strict on SPF alignment. Will dump misaligned mail into spam silently.
- `@bezeqint.net` — older greylisting; expect 5–10 min delivery delay on first send to a new recipient. Don't treat the delay as failure.
- `@012.net.il` — strict SPF; rejects with 5xx if `Return-Path` domain doesn't align with `From:`.
- `@netvision.net.il` — similar to 012.

Practical implication: **always use strict alignment** (`adkim=s; aspf=s` in DMARC, see section 2) and ensure your sending sub-domain matches the From: domain. If From is `verify@<your-domain>` and Return-Path is `bounces@send.<your-domain>`, that's still relaxed-aligned because both sit under `<your-domain>`. Don't use a sending sub-domain that crosses org boundaries.

### 5.3. Don't use gmail.com as From

`<business-name>@gmail.com` is a red flag for Israeli professional users (and a DMARC violation since 2024 — Gmail rejects DMARC-failing mail "from" gmail.com sent through third-party relays). Always send from `<your-domain>`.

### 5.4. תיקון 40 / Anti-Spam Law compliance

Out of scope for transactional mail (verification + security alerts are exempt — they're solicited by user action). But the moment we add a marketing/broadcast stream:

- Retain opt-in timestamps + IP per recipient (DB column or audit log).
- One-click unsubscribe via `List-Unsubscribe` header + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Resend supports both.
- Sender identification block in body footer: legal name, address, contact.
- This runbook does **not** authorize broadcast sends — those need a separate sub-account / sending stream in Resend so a marketing complaint doesn't tank transactional reputation.

---

## 6. Pre-flight checklist

Before flipping `D:\accountant\lib\auth\better.ts` hooks from `console.info(...)` to real Resend `emails.send(...)` calls, tick each box:

- [ ] **Resend domain status = Verified (green)** for `<your-domain>` or `mail.<your-domain>`.
- [ ] **DKIM key is 2048-bit** (not 1024). Inspect the `p=` value length in the dashboard or via `dig`.
- [ ] **SPF passes and aligns** with the From: domain. Confirm with a test send: Gmail "Show original" → `spf=pass` AND `dmarc=pass (dkim aligned)`.
- [ ] **DMARC TXT exists at `_dmarc.<your-domain>`** with at minimum `p=none; rua=mailto:dmarc-reports@<your-domain>`. Stage 1 of section 2.
- [ ] **`dmarc-reports@<your-domain>` mailbox exists** and someone reads it (or it pipes into a parser).
- [ ] **Test send passes** to each of: Gmail, Outlook.com / Hotmail, `@walla.co.il`, `@yahoo.com`, ProtonMail. Inspect headers in each — all must show DKIM=pass, SPF=pass, DMARC=pass. **Walla is the canary** — if it lands, the rest will land.
- [ ] **Webhook endpoint `/api/webhooks/resend` is reachable** from public internet (cannot be `localhost`). For pre-prod, use a tunnelled URL (ngrok / cloudflared) and update the Resend webhook URL accordingly.
- [ ] **Webhook signature verification implemented** — endpoint returns 401 on invalid Svix signature. Verified by sending a forged payload during testing.
- [ ] **Bounce + complaint handlers update DB** — verified end-to-end with Resend's "send test webhook" feature for each event type.
- [ ] **Rate-limit policy in Resend matches Better Auth's `5-per-15min` cap.** In Resend dashboard → API Keys → restrict to `emails.send` and set a soft rate limit at 5 req / 15 min per recipient. Better Auth's own rate limiter is the primary gate; Resend's is defense-in-depth so a Better Auth bug can't fire a million verifications.
- [ ] **From / Reply-To addresses configured** per section 3. `no-reply@` must not appear anywhere in the codebase — `grep -ri "no-reply" D:\accountant\lib` should return zero hits.
- [ ] **Test verification, password reset, and MFA enroll flows end-to-end** in a staging environment hitting real Resend (test domain, test inbox). Confirm the email arrives, link works, no warning banners in Gmail / Outlook ("This message couldn't be verified" etc).
- [ ] **Suppression check exists** — Better Auth's send hooks short-circuit when `user.email_invalid = true` or `user.email_suppressed = true`. Otherwise we burn API quota on dead addresses.

Only when every box is ticked: edit `lib/email/client.ts` to call Resend, and replace the `console.info(...)` calls in `lib/auth/better.ts` with awaits on the real client.

---

## 7. Code wired by Agent

Resend + the Better Auth send hooks are now wired. This section is the implementation map — what file does what, what env vars matter, and how to smoke-test without standing up the full DNS chain.

### 7.1. Files

| Path | Purpose |
|---|---|
| `lib/email/client.ts` | Thin Resend wrapper. Picks From: from `kind` (`verify`/`security`/`support`), defaults Reply-To to `support@<domain>`, renders React → HTML via a dynamic import of `react-dom/server.node` (Turbopack rejects static imports), short-circuits to a `dev-…` UUID when `RESEND_API_KEY` is unset or `NODE_ENV === "test"`. Marked `import "server-only"`. |
| `lib/email/dispatch.ts` | `byLocale: Record<AppLocale, Record<EmailKey, EmailTemplate>>`. `pickTemplate(locale, key)` + `fillText(template, vars)`. `ru-RU` intentionally falls back to `en-US` per Plan v4 Risk #24 (no CPA-reviewed Russian transactional surface). |
| `lib/email/lookupLocale.ts` | `lookupLocaleForUser(authUserId)` and `lookupLocaleForEmail(email)`. Both run under `withServiceRole` because Better Auth hooks fire before `app.current_user_id` is set. Both default to `he-IL` on miss / DB error — never throw, never crash signup. |
| `lib/email/templates/types.ts` | `EmailTemplate` + `EmailTemplateProps` shared shape. |
| `lib/email/templates/layout.tsx` | Inline-styled `<EmailLayout>` + `<EmailButton>` + `<Heading>` / `<Para>` / `<Muted>` primitives. No external CSS. 560px max width. |
| `lib/email/templates/he-IL/*.tsx` | 4 HE templates: `verify-email`, `reset-password`, `mfa-enrolled`, `welcome`. |
| `lib/email/templates/en-US/*.tsx` | 4 EN templates with same filenames. |
| `lib/auth/better.tsx` | Was `better.ts`. Renamed because the `sendVerificationEmail` / `sendVerificationOTP` hooks now construct JSX (`<tpl.Component …/>`). Import path `@/lib/auth/better` is unchanged. |

### 7.2. Env-var dependency graph

```
RESEND_API_KEY (optional)  ─┐
                            ├─→ lib/email/client.ts ──→ Better Auth hooks ──→ Resend API
BETTER_AUTH_URL  ───────────┘   (hostname → From: domain)

NODE_ENV=test  ─────────────────→ skip-mode (no network call, returns dev-UUID)
RESEND_API_KEY="" or unset ─────→ skip-mode
```

The wrapper never touches the network in skip-mode, so `pnpm test` / `pnpm dev` work without any Resend account configured. Production must have both `RESEND_API_KEY` and a `BETTER_AUTH_URL` whose hostname matches a Resend-verified domain (sections 1 + 3 of this runbook).

### 7.3. Smoke-test recipe

```bash
# 1. Verify skip-mode (no API key needed):
NODE_ENV=development RESEND_API_KEY="" pnpm dev
# In another shell:
curl -X POST http://localhost:3000/api/auth/forget-password \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","redirectTo":"/he-IL/reset-password"}'
# Expect: 200, server log: "[email] skip-mode would send { to: 'you@…', subject: '…', kind: 'security' }"

# 2. Wire a real key and re-test:
echo 'RESEND_API_KEY=re_test_…' >> .env.local
pnpm dev
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"correct-horse-battery-staple","name":"QA"}'
# Expect: 200 + email in inbox, From: AccounTech Verification <verify@<domain>>, Reply-To: support@<domain>
```

If the email arrives but DMARC fails, walk back through sections 1.2 + 5.2 — that's a DNS issue, not a code issue.

### 7.4. Deviations from the original brief

- **Resend `react` parameter NOT used.** Resend's `react` field requires the optional peer dep `@react-email/render`. Project policy is dependency-light templates, so `lib/email/client.ts` renders to HTML via `react-dom/server`'s `renderToStaticMarkup` and passes only `html`/`text` to Resend. The `react` field is accepted on `sendEmail`'s input for ergonomics but we render it ourselves.
- **`lib/auth/better.ts` renamed to `better.tsx`.** The two send hooks now embed JSX expressions. Importers use `@/lib/auth/better` which TypeScript's bundler resolution handles either way.
- **`react-dom/server` is dynamically imported.** Next 16 Turbopack refuses a static `import { renderToStaticMarkup } from "react-dom/server"` from any module reachable by a Server Component (see error "You're importing a component that imports react-dom/server"). `lib/email/client.ts` therefore builds the specifier at runtime: `const modName = "react-dom" + "/server.node"; await import(modName)`.
