# Product + UX Council Review — AccounTech

**Reviewer:** Product + UX
**Date:** 2026-05-16
**Subject:** Onboarding flow, dashboard, IA, empty states, mobile, killer feature, accountant tier, RTL/a11y, pricing
**Posture:** opinionated. The user is asking us to displace IL accountants. "Another invoice tool" loses to Green Invoice / iCount / EZCount on day one — they are entrenched, they sync to SHAAM, they cost ₪29-89/mo. We have to be different in a way that an עצמאי can describe to a friend in one sentence.

---

## 1. Executive Summary — the one thing

**Stop framing AccounTech as "invoicing + receipts + estimates with a CPA mode bolted on top". That is exactly Green Invoice's positioning, and Green Invoice's basic tier is ₪29/mo with SHAAM clearance live today.** We do not win that fight.

**Frame it as: "The Tax-Anxiety Dashboard for Israeli עצמאים."** A single morning view that tells you, in plain Hebrew, before coffee:

> "החודש אתה צריך להעביר ₪3,420 למע״מ ב-15.7. יש לך ₪2,180 ברזרבת המס. חסר ₪1,240. הוצאה אחת לא סווגה (קבלה מ-Ofer Yogev, ₪380). אם תקטלג אותה כ-"שיווק" המע״מ הצפוי יורד ל-₪3,355."

The data we already collect (transactions + invoices + receipts + business profile + vat_status) **already underlies this**. The competitors have the same data but optimise for "issue a חשבונית fast". They expose data; we exposé **anxiety relief**.

Every other product decision in this memo follows from that frame. Onboarding cuts, dashboard tiles, empty-state copy, killer feature, accountant tier — they're all aimed at "by 09:00 tomorrow morning, the עצמאי knows what they owe, what's coming, and what's at risk."

If we don't pick a frame, the product reads as a worse, more-expensive Green Invoice with a disclaimer banner.

---

## 2. Onboarding Cuts

### Current flow (counted from `SignUpForm.tsx` → `dashboard/page.tsx`)

1. `/sign-up` — name, email, password, password confirm, accept ToS, Turnstile, submit (**7 inputs**)
2. `/verify-email` — wait for email, click link, return (**1 inter-app round-trip + cognitive context switch**)
3. `/post-auth` — invisible redirect
4. `/2fa/enroll` — re-enter password + scan QR + verify TOTP + view backup codes (**~4 inputs + cognitive load: install authenticator app**)
5. `/recovery-codes` — confirm seen
6. `/onboarding` step 1 — pick language (already pre-selected via cookie — **redundant**)
7. `/onboarding` step 2 — legalName + vatId + entityType + vatStatus + bookkeepingMethod + 3 address fields (**8 inputs**)
8. `/onboarding` step 3 — success splash
9. `/dashboard` — empty (no data) + empty-state CTA → push them to `/transactions/new`
10. `/transactions/new` — first transaction form

**Total: ~10 steps, ~22 distinct decisions/inputs before they see a dashboard with value.** For comparison, Green Invoice: sign up → "issue invoice" CTA, single screen.

### Cuts to make (ranked by impact)

| # | Cut | Why | Saves |
|---|---|---|---|
| 1 | **Make 2FA enrollment optional at sign-up. Defer to first sensitive action (invoice issue ≥ ₪10k or settings change).** | Right now an עצמאי opening a free trial at 22:00 sees a TOTP QR before they've seen any product value. ~50% will bail here. | 3 steps + install-authenticator-app cognitive load |
| 2 | **Kill onboarding step 1 (locale picker).** | The `[locale]` segment already pinned the locale from URL/cookie. Showing it again is a non-decision. | 1 step |
| 3 | **Merge `entityType`, `vatStatus`, `bookkeepingMethod` into one question: "מה סוג העסק?" → 3 cards (פטור / מורשה / חברה).** | The current `defaultsFor()` already derives vatStatus + bookkeepingMethod from entityType — show ONLY entityType in UI; surface the derived values as a single line ("עוסק מורשה, חד-צידי") and let advanced users tap "ערוך" to override. The 5 entity types collapse for 95% of users. | 2 form fields, 1 cognitive checkpoint |
| 4 | **Make the address optional in step 2.** It is required on the invoice but not required to see the dashboard. Defer to "when you issue the first חשבונית, fill the missing fields." | Address blocks a user who just wants to load receipts before opening their first invoice. | 3 form fields |
| 5 | **Collapse the success splash (step 3) into a toast on `/dashboard`.** | The "/onboarding/complete → click → /dashboard" double-step is a UX tax for celebrating something that didn't deserve a full page. | 1 step |
| 6 | **Move email verification to deferred-gating: allow read-only dashboard access pre-verification; gate "send first email/issue first חשבונית" on verified email.** | Most users won't trust us until they see what the app does. Forcing a tab-switch to gmail to "see anything" is friction. | 1 inter-app context switch |

### Result after cuts

`/sign-up` (5 inputs: name, email, password, ToS, captcha) → `/dashboard` with pre-filled "tell us about your business" inline card (3 inputs: legalName + vatId + business-type-card). **2 steps, 8 inputs, no context switch.**

### What should be added (counter to the user's "is locale+business+first-txn enough?" question)

Yes for v1. **NOT** a CoA template picker, **NOT** a bank-quick-connect, **NOT** a first-client form. Adding any of those at onboarding pushes us back to 10 steps. Surface them as **non-blocking checklist cards on the dashboard**:

- "📥 העלה את 3 הקבלות הכי אחרונות שלך" (drag-drop)
- "🔌 חבר את חשבון Hyp שלך" (one-tap OAuth, F.4)
- "👤 הוסף את הלקוח הראשון" (pre-filled form when they go to issue invoice anyway)

Onboarding is the path; the dashboard checklist is the trampoline.

---

## 3. Dashboard Tile Redesign — the canonical 6

Current dashboard tiles (`DashboardView.tsx`):
- ARR estimate
- Net margin %
- EBITDA YTD sum
- YoY growth %

**These are marketing-deck KPIs cloned from `Dashboard.tsx` for visual parity. They mean nothing to an עצמאי.** An עצמאי doesn't think in ARR. They think:
- "כמה כסף יש לי בבנק?"
- "כמה אני חייב למע״מ בחודש הבא?"
- "מי לא שילם לי?"

### Replace with these 6 tiles, in this priority order

| Rank | Tile | Source | "I'm doing this because" |
|---|---|---|---|
| **1** | **מע״מ צפוי לתקופה הקרובה** with countdown ("19 ימים עד 15.7") | aggregate over `invoices` issued in period - `receipts.vat_recoverable_minor` deducted | This is THE anxiety the product solves. Put it at the top, big number, traffic-light colour. |
| **2** | **מזומן זמין** (cash-on-hand) across all `financial_accounts` (less the מע״מ-reserve recommendation) | sum of opening balance + ledger movement per FA | Tells them whether they CAN pay the מע״מ bill above. Pair them visually. |
| **3** | **חשבוניות פתוחות** (overdue count + total ₪) | invoices.due_date < today AND linked_journal_entry has no payment | The single biggest "where's my money" question. Click → list of debtors. |
| **4** | **קבלות לקטלוג** (uncategorised receipts) | receipts.status='pending_review' OR receipts.category_code IS NULL | Direct nudge to do the data-entry that powers tiles 1 + 5. Number badge style. |
| **5** | **מקדמות הבאות + ניצול עד כה** | tax_advances (when schema layer 3 lands) | "אתה משלם ₪1,200 ב-15.8. עד עכשיו צברת רווח של ₪14,800." Connects today's behaviour to a future bill. |
| **6** | **רווח החודש vs הממוצע של 3 חודשים** (trend sparkline) | rolling window over `journal_entries` summed | The only "performance" KPI an עצמאי emotionally connects with. Net margin % is too abstract. |

**Cut from current dashboard:** ARR estimate (an עצמאי is not VC-funded), YoY growth (most users won't have a prior year for 18 months).

**Keep:** the revenue-vs-profit bar chart as a secondary section, NOT the hero. Below the 6 KPI tiles, under a "מסלול רווח (12 חודשים)" heading.

---

## 4. Information Architecture (Sidebar)

Current sidebar (`AppShell.tsx` NAV_ITEMS):
> Dashboard · Businesses · Clients · Transactions · Ledger · Invoices · Receipts · Settings

### Findings

- **"Businesses" as a top-level item is wrong for the dominant persona.** 95% of עצמאים have ONE business. Surface "Businesses" only inside Settings (or as a business switcher in the header, like the user-menu dropdown). Showing it top-level signals "this is multi-business software" which conflicts with the עצמאי framing and adds visual weight.
- **"Transactions" and "Ledger" are bookkeeper jargon.** An עצמאי thinks "כסף שנכנס, כסף שיצא". Merge → **"תנועות"** (Transactions) is fine — but expose Ledger only on accountant or hevra_baam users (gate by `entityType` and `accountant_engagements` presence). Single-entry users don't need to see a double-entry ledger and will think they're missing something.
- **"Reports" should exist** but it should be a tab/sub-page under Dashboard, not a top-level item. Most עצמאים open the report 4× a year. Putting it on the sidebar is dead weight.
- **"Tax" deserves top-level placement.** It is the product's reason for existing. Currently it does not exist as a sidebar item — only buried behind dashboard KPIs. Wrong.
- **"Projects" — user's goal mentions "projects" but the current schema has no `projects` table.** Adding a top-level Projects item without the schema is premature. **Decision: defer; revisit after F.5.** Most עצמאים do not run "projects" — they run jobs / חשבוניות. "Projects" is consulting-firm jargon and aligns more with the Accountant tier than the עצמאי tier.

### Recommended sidebar (single-business עצמאי mode)

```
🏠 בית               (Dashboard)
🧾 חשבוניות           (Invoices)
🧾 קבלות והוצאות       (Receipts — rename to make the expense-side meaning explicit)
💵 תנועות              (Transactions)
👤 לקוחות              (Clients)
🧮 מסים                (Tax — NEW; sub-tabs: מע״מ, מקדמות, סיום שנה)
─────────────
⚙ הגדרות             (Settings — host Business profile, Bank accounts, Plan, Team, Integrations)
```

7 items collapsing to 6 logical chunks. "Ledger" appears only as a Tax sub-tab for hevra_baam / accountant users.

### Recommended sidebar (Accountant ₪399 tier)

The Accountant persona switches contexts constantly. Their IA should be:

```
🏢 לקוחות (multi-business)      ← engagement_switcher dropdown
🏠 בית                          ← KPIs aggregated across all engagements
📋 דיווחים בהמתנה                ← bulk-filing prep, this is the workhorse
🧾 חשבוניות (לכל הלקוחות)
🧮 מסים (לכל הלקוחות)
📦 חבילות סגירה שנתית             ← year-end audit_package, the value driver
📂 ארכיון
─────────────
⚙ הגדרות
```

Same components, fundamentally different framing: the עצמאי sees "my business". The accountant sees "20 businesses, give me the bulk-prep view".

---

## 5. Empty-State Copy Bank

Current copy (`en-US.json`, `app.dashboard.empty`):
> "No data yet" / "Add your first transaction or invoice to see estimates here." / "Add first transaction"

**Verdict: passable in EN, bland in HE.** It tells the user the app is empty but not what to do or why. Empty state is where retention is won or lost.

### Per-page empty-state recommendations

#### `/dashboard`

```
HE:
title:  "התחיל להעלות קבלות — אנחנו נעשה את החשבונאות"
desc:   "צלם קבלה אחת ב-30 שניות. מאותו רגע נוכל לחשב את חשבון המע״מ שלך, להראות לך כמה רווחת ולהציע לאן ללכת."
cta1:   "📷 צלם קבלה ראשונה"            (primary)
cta2:   "⌨ הזן תנועה ידנית"              (secondary)
cta3:   "🧾 הוצא חשבונית מס ראשונה"      (tertiary)
```

#### `/transactions`

```
HE:
title:  "כאן יתועדו כל הכספים שזזים בעסק"
desc:   "כסף שנכנס מלקוח, הוצאה מכרטיס אשראי, העברה לחיסכון — כל אלו 'תנועות'. תוכל להזין ידנית, להעלות דף בנק, או לחבר את הסולק."
cta1:   "+ תנועה ראשונה"
cta2:   "📑 העלה דף בנק"
cta3:   "🔌 חבר Hyp / Grow / PayPlus"
```

#### `/invoices`

```
HE:
title:  "מוכן לחשבונית הראשונה?"
desc:   "מספר עוסק תקין, לקוח עם ע.מ./ח.פ. שמור, ויש לך חשבונית מס תקנית בתוך 10 שניות. החל מ-2026-06-01 חשבוניות מעל ₪5,000 חייבות במספר הקצאה — נטפל בזה בשבילך."
cta1:   "+ חשבונית מס חדשה"
cta2:   "📥 ייבא חשבוניות קודמות"
```

#### `/clients`

```
HE:
title:  "אין לקוחות עדיין"
desc:   "תוסיף את הלקוחות שלך פעם אחת, ותוכל להוציא להם חשבוניות ב-2 קליקים. נשמור את הע.מ. שלהם, פרטי תשלום ותנאי תשלום."
cta1:   "+ לקוח ראשון"
cta2:   "📥 ייבא מ-CSV"
```

#### `/receipts`

```
HE:
title:  "אין קבלות נכנסות"
desc:   "כל קבלה שתעלה ייכנס למע״מ שלך אוטומטית. OCR יקרא את הסכום, התאריך והספק — אתה רק תאשר."
cta1:   "📷 צלם קבלה" (visible on mobile only)
cta1:   "📥 העלה קבלה" (visible on desktop)
cta2:   "📧 חבר תיבת מייל לקבלות"  ← (deferred F.3, but show as "soon")
```

### Pattern rules

1. **Title states the value, not the absence.** Not "No clients yet" → "אין לקוחות עדיין" + tells them the upside of having one.
2. **Always 2-3 CTAs.** Primary path + alternative path + import-from-elsewhere. The "I'm switching from Excel" user lands here too.
3. **Mobile-aware CTA copy.** "צלם קבלה" only makes sense on a phone; "העלה" makes sense on desktop. Don't say "צלם" on a laptop with no camera.

---

## 6. Mobile Features

The handoff confirms the design system is desktop-first (the homepage's r3f hero is gorgeous on a 14" laptop, jarring on a 5" phone). The AppShell already has a working mobile hamburger and RTL drawer — good baseline.

But running the business from a phone is the actual עצמאי behaviour. Some critical features:

### Mobile feature priority

1. **Camera receipt capture (P0).** Wire a PWA "Add to home screen" prompt + `<input type="file" accept="image/*" capture="environment">` on `/receipts/new`. OCR fires in the background, user dismisses the camera and goes back to whatever they were doing. Then a toast "✅ קבלה מ-Tiv Taam, ₪47.20, מע״מ ₪7.20 — סווגה כ-'מזון לצוות'? [שנה]". This is the single most-used mobile flow. **The schema already supports it** (`receipts.source = 'upload'`, `receipts.fileBlobUrl`, `receipts.businessUsePct`).
2. **Quick-invoice (P1).** Pre-filled "issue חשבונית to {last-3-clients}" picker. One tap → choose client → choose amount in a numeric pad → 1 tap to issue. For repeat clients (which is most of עצמאי business), this is 4 taps and 5 seconds. The current `/invoices/new` flow is a desktop multi-field form.
3. **Tax-bill widget on iOS home screen (P2).** A widget showing the next מע״מ deadline + amount. This is brand-defining if we can ship it.
4. **Notifications: payment reminders + tax reminders + new receipt OCR confirmation.** Web Push API works in modern iOS Safari (>16.4). Set up in F.5.

### Mobile-specific UX bugs to fix now

- **Dashboard KPI grid: `grid-cols-2 lg:grid-cols-4`** — on a phone, 4 KPIs become 4 short rows. Need at most 2-tile-wide carousels for compactness, or vertical-list mode below `sm:`.
- **Sidebar drawer in RTL: animates from `end-0` correctly, BUT the open-state pointer-events workaround is suspicious** — verify it lets users tap the overlay to close.
- **Forms: `dir="ltr"` on numeric inputs (vatId, postalCode)** is correct but the labels are RTL. Test the visual flow on a real iPhone in Hebrew. Right-aligned label with LTR input often looks confusing.

---

## 7. Killer Feature Pick

**The killer feature is option (a), restated:**

> **"Morning Tax Brief"** — every day at 08:00 local time, the user gets a push notification + in-app card with a single plain-Hebrew sentence and one number:
>
> _"בוקר טוב יוסי. ביום ראשון 15.7 תצטרך להעביר ₪3,420 למע״מ. יש לך ₪2,180 ברזרבת. חסר ₪1,240 — שלוש חשבוניות פתוחות מעל ₪5k אצל לקוחות, גביה תכסה אותך אם תפנה אליהם השבוע."_

### Why this is the killer, ranked

1. **It removes the single biggest mental load of being an עצמאי in Israel: not knowing what they owe and when.** Green Invoice tells you what you've earned. iCount tells you what you've issued. **Nobody tells you what you owe + what you can do today to avoid the panic.** That gap is the whole product.
2. **The schema and inputs already exist.** `transactions` + `invoices` + `receipts` + `businesses.vat_status` is enough to compute it. No new data primitives required.
3. **It's defensible against Green Invoice.** They'd have to fundamentally re-skin to position this — their UI is built around document issuance.
4. **It's habit-forming.** Daily morning notification = daily app open = retention. ARR per user goes from "I use it twice a month to issue a חשבונית" to "I open it every morning."
5. **It unlocks the AI tier upsell naturally.** "Want to know WHY the מע״מ is higher this month? Ask the AI." → ₪99 tier.

### Why we should NOT pick (b) "instant invoice with allocation-number sync"

Because Green Invoice already does this, and SHAAM cert is 9-18 months out per the handoff. We'd be playing catch-up on table stakes.

### Why we should NOT pick (c) "year-end packet for ₪500 instead of ₪5000"

Long-tail. עצמאים stress about year-end ONCE a year. They stress about מע״מ EVERY MONTH. Build for the monthly habit, the annual packet is a downstream byproduct.

---

## 8. Accountant Tier ₪399 — Value-Prop Tightening

The Accountant persona is the most leveraged customer (1 sale = 20 sub-accounts of usage data). The current schema (`accountant_engagements` + `scopes_jsonb`) is the right primitive but the product surface is empty.

### What an accountant managing 20 small clients NEEDS that the current build doesn't have

| Need | Schema gap | Product gap |
|---|---|---|
| **Bulk PCN874 / 102 / 6111 prep view** ("8 clients due 15.7, 3 ready, 5 missing receipts") | tax_filings exists but no bulk-view aggregation | A `/accountant/filings-queue` page with status pills per client × per filing kind |
| **Branded client portal** ("powered by Sigal CPA Ltd") | logoBlobUrl on businesses but not on engagements | White-label option: accountant's logo on client emails + PDF cover. Sell at ₪399 — most CPAs will pay for the brand-asset alone |
| **Time tracking per client** | No table | **Defer.** This is a CPA-firm-mgmt feature; building it pulls us toward "AccounTech for accountants" not "AccounTech for businesses with optional CPA". |
| **Project profitability per client** | No table | **Defer.** Same reason — accountant-firm scope creep |
| **Bulk message client** ("hey, all 20 of you, please upload your June receipts by 5.7") | No table | A `/accountant/broadcast` page that sends a templated email through Resend with per-engagement merge fields. Cheap, high-value. |
| **Audit trail of accountant actions on each business** | `auth_events` exists | Surface as `/accountant/clients/[id]/audit` — for liability protection. CPAs are paranoid about this. |
| **Read-only "view as client" mode** | scopes_jsonb already supports this | One-tap "view this business as the owner sees it" — for debugging client questions. |

### Tightened ₪399 value prop

> **"AccounTech Pro — one dashboard for all your clients. Bulk file PCN874s, push receipts back to clients, surface every red flag before the מס הכנסה does, white-label everything with your firm's logo. From ₪399/mo — covers 5 clients. ₪59 per additional client."**

The `₪59 per additional client` per-seat tail is critical. It scales revenue without re-tiering. Otherwise, 20-client accountants are paying the same as 5-client accountants, and we're leaving money on the table.

---

## 9. RTL + a11y Findings

### RTL breakage

| Where | Problem | Fix |
|---|---|---|
| **`AppShell.tsx` sidebar `lg:border-${isRtl ? 'l' : 'r'}`** | Tailwind template literal — won't get picked up by the JIT. The class isn't generated. | Use `lg:border-r rtl:lg:border-l rtl:lg:border-r-0` or static class swap. |
| **`KpiCard`-style numeric content** (`₪${formatCurrencyShort(...)}`) | Currency symbol position. `Intl` with `en-IL` puts ₪ before; HE-readers expect ₪ after the number ("3,420 ₪"). Currently mixing. | Use `he-IL` formatter inside HE locale or hard-format with a helper. |
| **Recharts (`RevenueEbitdaChart`)** | Recharts axis ticks render LTR by default. With HE month labels ("ינו׳") the X-axis order can flip confusingly. | Reverse the data array in HE OR set `<XAxis reversed />` based on locale. Validate visually before launch. |
| **`OnboardingProgress` step indicators** | If they go 1→2→3 left-to-right in HE, they cognitively read "backwards." | Flip indicator order on RTL or use a vertical progress bar (works in both directions). |
| **Sidebar `motion.aside` `x: isRtl ? '100%' : '-100%'`** | The animation logic is correct, but combined with `end-0`/`start-0` static positioning, in some flex containers it stacks wrong. | Manual test on lg breakpoint with HE. The current code looks correct but the static layout test wasn't shown to me. |
| **Modal drawers (chunk B forms)** | No modal exists yet. When chunk C lands invoice forms, "side drawer" patterns must be RTL-aware. | Define the drawer pattern in the design tokens before chunk C writes it ad-hoc. |
| **Table sort arrows** (chunk B `BusinessList` etc.) | If table headers use `<ArrowUp>/<ArrowDown>` Lucide icons next to text, they read "backwards" in HE | Use `▲▼` Unicode chars or position arrows on the start-side via logical props. |

### a11y findings (auth forms, the only finished area)

| Where | Issue | Severity | Fix |
|---|---|---|---|
| **`SignInForm.tsx` / `SignUpForm.tsx` `<Field>` component** | `<label><span>...label...</span><input/></label>` — implicit association works, BUT some screen readers (older NVDA) don't pick up the span as the label name. | Low | Use explicit `<label htmlFor={id}>` + `<input id={id} aria-labelledby={id}>` for safety. |
| **Field error states** | The form-level error renders in a single `role="alert"` div at the bottom. Field-level errors (which field is wrong) aren't associated to the input via `aria-describedby` or `aria-invalid`. | Medium | When `error` mentions field X, add `aria-invalid="true"` and an `aria-errormessage`. |
| **Disabled buttons during submit** | `disabled={submitting}` removes pointer-events but keeps focus — fine. However the loading state doesn't announce "loading..." to screen readers. | Medium | Add `aria-busy="true"` and an `aria-live="polite"` zone reading "מאמת..." / "Signing in...". |
| **Turnstile widget** | Cloudflare's widget injects iframe content. The dir is forced LTR via `dir="ltr"` — OK. But there's no accessible label. | Low | Wrap in `<div role="group" aria-label="אימות אנושיות">`. |
| **Backup codes display (`TwoFactorEnrollForm`)** | Grid of `<span>`s with no semantic structure. Screen reader will read them as one long stream. | Medium | Use `<ul role="list">` + `<li>` per code, and make the "copy all" button announce "כל הקודים הועתקו" via live region. |
| **Color-only severity signals** | Emerald = good, red = error, amber = backup-codes. Color is the ONLY signal in many places. | Medium | Pair every color with a status icon (`<CheckCircle2/>`, `<AlertTriangle/>`, `<ShieldCheck/>`). |
| **Focus ring contrast** | `focus:ring-emerald-500/30` against a dark slate background is decorative-pretty but barely meets WCAG AA. | Low | Bump to `/50` for focus, or add a hard border. |
| **Reduced-motion** | Framer-motion animations (the per-step `motion.div initial/animate`) don't respect `prefers-reduced-motion`. | Medium | Wrap in `<MotionConfig reducedMotion="user">` at the app layout level. One line. |
| **Onboarding `RadioCards`** | Uses `<input type="radio" className="sr-only">` + label as visual target. The label is clickable but the visual radio dot is decorative `aria-hidden`. Keyboard nav works but the focus ring lives on the hidden input → no visible focus. | High | Add `peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400` to the label, or render the radio visibly. |

---

## 10. Pricing Critique vs IL Competitors

### Verified IL competitor pricing (2026-05-16, via greeninvoice.co.il/pricing)

| Tier | Green Invoice | iCount* | EZCount* |
|---|---|---|---|
| Basic | ₪29 (20 docs/mo, 1 business) | ~₪59 | ~₪49 |
| Mid | ₪54 (50 docs, 2 businesses) | ~₪119 | ~₪89 |
| Plus | ₪89 (200 docs, 3 businesses) | ~₪199 | ~₪169 |
| Top | ₪155 (500 docs, 5 businesses) | ~₪299 | ~₪249 |

*iCount and EZCount estimates are from third-party comparisons; their pricing pages were not fully fetched. Trust as directional only.

### AccounTech tiers vs market (current plan v4)

| Tier | AccounTech | Verdict |
|---|---|---|
| Free | ₪0 | OK — Green Invoice has no real free tier, this is a wedge |
| Solo | ₪49 | **Underpriced vs value, overpriced vs Green Invoice ₪29 Basic.** If we differentiate on tax-anxiety dashboard + AI (per §1, §7), ₪49 is defensible. If we frame as "invoicing + receipts" we lose to ₪29. |
| Plus | ₪99 | **Awkward middle.** What does Plus add over Solo? The handoff doesn't pin entitlements. We need a clear "Solo → Plus" reason: probably "AI brief + multiple businesses + processor sync". |
| Business | ₪199 | OK — but `accountant_engagements` should be the upsell driver; "invite your accountant" is a Business feature, not Plus. Green Invoice's ₪155 includes 5 businesses; we need to be MORE at this tier. |
| Accountant | ₪399 | **Too low** vs CPA-firm willingness-to-pay if it covers all their clients (₪399 / 20 clients = ₪20/client/mo, hard to defend ops cost). **Restructure to ₪399 base + ₪59/additional-client beyond 5** (§8). |

### Recommended pricing

| Tier | Price | "Reason to upgrade" | Compare against |
|---|---|---|---|
| Free | ₪0 | Up to 5 חשבוניות/mo, 1 business, no AI brief | Green Invoice has no free → wedge |
| Solo | ₪39 | **Re-price down** to match Green Invoice Basic + offer Morning Tax Brief, unlimited receipts, OCR. Compete head-on at the basic tier. | Green Invoice ₪29 |
| Plus | ₪89 | AI advisor (50 msg/mo), processor sync, multi-currency, 2 businesses | Green Invoice ₪54 + AI |
| Business | ₪179 | 5 businesses, accountant invite, white-label invoice PDF, audit-package generator | Green Invoice ₪89 |
| Accountant | ₪449 base + ₪59/client beyond 5 | Multi-business view, bulk-prep, broadcast, branded portal | No direct competitor in IL |

The repricing matters: **at ₪49 Solo we are perceived as more expensive than Green Invoice's ₪29 for less feature parity, and our "tax brief" differentiator isn't yet enough to justify the gap to a buyer who hasn't yet experienced it.** ₪39 anchors us close enough that the upsell to ₪89 Plus (AI) reads as the real value moment.

---

## Appendix — Open product questions for next council

1. Does the user want Morning Tax Brief shipped as **part of Solo** (wedge) or **gated to Plus** (upsell)? Recommend: free preview for first 30 days on Solo, then upsell to Plus for full daily access + AI follow-up.
2. PWA + iOS home-screen widget timeline — pre-Phase E or post?
3. White-label invoice PDFs (Accountant tier) — is this a Phase C deliverable or a deferred Phase G item?
4. Should the "תיק ניכויים" (`businesses.tikNikuyim`) be required for ח.פ. + payroll users at onboarding, or deferred to first payroll run? Recommend defer.
5. Pricing recalibration to ₪39/₪89/₪179 needs a CPA + finance sanity check on unit economics before commit.
