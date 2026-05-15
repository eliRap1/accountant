# Phase A — Manual QA Checklist

Last updated 2026-05-16 alongside Phase A.7 verification work.

Use this sheet before declaring Phase A shippable. Run each check on a
clean browser profile (Chrome stable + Safari Tech Preview + Firefox
release). Reset cookies between locales.

## Pre-flight

- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm lint:rule-meta` clean (no-op until Phase D)
- [ ] `pnpm lint:legal-text` clean (no-op until tax routes)
- [ ] `pnpm lint:missing-translations` clean
- [ ] `pnpm lint:ru-app-leak` clean
- [ ] `pnpm test:unit` green
- [ ] `pnpm test:integration` green (or documented skip if no DB)
- [ ] `pnpm build` succeeds with no warnings
- [ ] `pnpm test:e2e` smoke green on chromium + firefox
- [ ] Pixel-diff baseline within 0.5% on he-IL + en-US + ru-RU landings

## Sign-up flow (Turnstile gate)

he-IL:
- [ ] Visit `/he-IL/sign-up`. Verify form labels in Hebrew, RTL layout.
- [ ] Turnstile widget renders (only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set).
- [ ] Submit with mismatched passwords → form shows error in Hebrew.
- [ ] Submit with password under 12 chars → error in Hebrew.
- [ ] Unchecked terms → error in Hebrew.
- [ ] Successful submit → redirected to `/he-IL/verify-email?email=...`.

en-US:
- [ ] Repeat the above at `/en-US/sign-up`. (Current copy is Hebrew —
  flag this as a P1 follow-up: the form needs translation strings.)

## Verify-email flow

- [ ] After signup, the Resend hook fires (visible in Resend dashboard or
  in stdout when `RESEND_API_KEY` is unset).
- [ ] Click the verification link in the email — lands on a verified-state
  page in the locale the email used.
- [ ] `autoSignInAfterVerification: true` means clicking the link signs
  the user in. Confirm cookie set.

## 2FA enroll + verify

- [ ] Sign in. Navigate to `/he-IL/2fa/enroll` (route TBD — currently
  scaffold). Scan QR with authenticator. Enter 6-digit code → enroll
  succeeds.
- [ ] Sign out. Sign in again. Prompted for TOTP. Wrong code → blocked.
  Right code → through.
- [ ] Disable 2FA from `/he-IL/2fa` (requires step-up — deferred per
  handoff.md P0 #2).

## Passkey add + delete

- [ ] On Chrome + macOS — register a passkey. Use Touch ID. Listed in
  `/he-IL/passkeys`.
- [ ] On Safari — register a second passkey. Listed.
- [ ] On Firefox — register a third passkey. Listed.
- [ ] Delete one passkey. Verify removed.
- [ ] Sign out, sign in via passkey from each browser.

## Recovery codes

- [ ] After 2FA enroll, copy the 10 recovery codes to a password manager.
- [ ] Sign out, attempt sign-in with TOTP, then click "use recovery
  code" — paste one. Successful sign-in marks the code as used.
- [ ] Repeat with an already-used code → blocked.

## Forgot / reset password

he-IL:
- [ ] `/he-IL/forgot-password` — enter email. Email arrives.
- [ ] Click reset link → `/he-IL/reset-password?token=...`. Enter new
  password → updated.
- [ ] Old password rejected. New password accepted.

en-US:
- [ ] Repeat at `/en-US/forgot-password`.

## Locale switcher (Navbar / StickyCTA)

- [ ] Default landing on `/` redirects to `/he-IL`.
- [ ] Switch to en-US — content stays on the same page, copy is English,
  `<html dir="ltr">`.
- [ ] Switch to ru-RU on landing — copy is Russian, marketing only.
- [ ] Switch to ru-RU then navigate to `/sign-in` — URL becomes
  `/ru-RU/sign-in` but body renders English (rewrite per Plan v4 §24).

## ru-RU app route guard

- [ ] `/ru-RU/sign-in` shows the English sign-in form (rewrite).
- [ ] `/ru-RU/sign-up` shows the English sign-up form.
- [ ] `/ru-RU/2fa/enroll` shows the English 2FA enrollment.
- [ ] `/ru-RU` shows the Russian marketing landing (not rewritten).

## RTL spot-check in he-IL

- [ ] Sign-in form — labels right-aligned, input direction LTR for email
  and password.
- [ ] Navbar — logo on the right, language switcher on the left.
- [ ] Sticky CTA — text right-aligned, arrow icon mirrored.
- [ ] Hero copy — text right-aligned.
- [ ] Dashboard mock — chart axes still readable; tooltips render to
  the correct side.

## Performance smoke

- [ ] `/he-IL` LCP under 2.5s on a throttled 3G profile.
- [ ] Hero canvas renders without dropping below 30 FPS on a 2020-era
  MacBook Air.

## Pre-launch follow-ups (do NOT block Phase A merge but track)

- Lawyer-reviewed ToS / Privacy / Disclaimer copy.
- Sign-up form text translation parity (he-IL is currently the only
  fully-translated surface).
- Step-up scope-binding (handoff.md P0 #2) before any sensitive op.
- Secret rotation (handoff.md Security table).
- IL Privacy Authority registration submitted.
