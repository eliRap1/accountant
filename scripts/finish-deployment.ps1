# scripts/finish-deployment.ps1
#
# Drives all 6 owner-side gates from a single PowerShell session.
# Run from D:\accountant. Prerequisite: Vercel CLI installed
# (`npm i -g vercel` if not).
#
# Each gate is independent. Re-run is safe (each step is idempotent
# OR fails loudly with a clear next action).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host ""
Write-Host "=== AccounTech production deployment finish ===" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Gate 1 — Rotate the 5 compromised secrets
# ---------------------------------------------------------------------------
Write-Host "[Gate 1] Rotate compromised secrets" -ForegroundColor Yellow

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes1 = New-Object byte[] 32; $rng.GetBytes($bytes1)
$bytes2 = New-Object byte[] 32; $rng.GetBytes($bytes2)
$bytes3 = New-Object byte[] 32; $rng.GetBytes($bytes3)
$NEW_BETTER_AUTH_SECRET  = [Convert]::ToBase64String($bytes1)
$NEW_DATA_ENCRYPTION_KEY = [Convert]::ToBase64String($bytes2)
$NEW_CRON_SECRET         = [Convert]::ToBase64String($bytes3)

Write-Host "  Generated 3 fresh secrets (Better Auth, Data Encryption, Cron)." -ForegroundColor Green
Write-Host "  Save them OUT OF BAND now — they will be pasted into Vercel in gate 2."
Write-Host ""
Write-Host "  BETTER_AUTH_SECRET   = $NEW_BETTER_AUTH_SECRET"
Write-Host "  DATA_ENCRYPTION_KEY  = $NEW_DATA_ENCRYPTION_KEY"
Write-Host "  CRON_SECRET          = $NEW_CRON_SECRET"
Write-Host ""
Write-Host "  STILL TO DO IN PORTALS (cannot be automated — owner credentials only):"
Write-Host "    [ ] Neon console        → reset password → grab new pooled + unpooled DATABASE_URLs"
Write-Host "    [ ] resend.com          → API Keys → revoke 're_JAJTW…' → issue new RESEND_API_KEY"
Write-Host "    [ ] Cloudflare Turnstile → site → Rotate Secret → grab new TURNSTILE_SECRET_KEY"
Write-Host ""
Read-Host "Press Enter once the 3 portal rotations are done (you'll paste values below)"
$NEW_DATABASE_URL          = Read-Host "Paste new DATABASE_URL (pooled)"
$NEW_DATABASE_URL_UNPOOLED = Read-Host "Paste new DATABASE_URL_UNPOOLED (direct)"
$NEW_RESEND_API_KEY        = Read-Host "Paste new RESEND_API_KEY"
$NEW_TURNSTILE_SECRET_KEY  = Read-Host "Paste new TURNSTILE_SECRET_KEY"
$NEW_TURNSTILE_SITE_KEY    = Read-Host "Paste NEXT_PUBLIC_TURNSTILE_SITE_KEY (Cloudflare site key — public)"
$NEW_AI_GATEWAY_API_KEY    = Read-Host "Paste AI_GATEWAY_API_KEY (Vercel AI Gateway → API Keys)"
$DEPLOY_URL                = Read-Host "Production deploy URL, no trailing slash (e.g. https://accountant.example.com)"

# ---------------------------------------------------------------------------
# Gate 3 — Stripe Products (interactive — Stripe Dashboard is web-only)
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[Gate 3] Stripe Products" -ForegroundColor Yellow
Write-Host "  Create 4 products in Stripe Dashboard → Products → New."
Write-Host "  Prices VAT-inclusive (Israel is NOT in Stripe Tax)."
Write-Host ""
Write-Host "    Solo        ₪49 / month ILS  → STRIPE_PRICE_SOLO"
Write-Host "    Plus        ₪99 / month ILS  → STRIPE_PRICE_PLUS"
Write-Host "    Business    ₪199 / month ILS → STRIPE_PRICE_BUSINESS"
Write-Host "    Accountant  ₪399 / month ILS → STRIPE_PRICE_ACCOUNTANT"
Write-Host ""
Write-Host "  Webhook endpoint: $DEPLOY_URL/api/billing/webhook"
Write-Host "  Copy the webhook signing secret."
Write-Host ""
Read-Host "Press Enter once the 4 products + webhook are configured"
$STRIPE_SECRET_KEY       = Read-Host "Paste STRIPE_SECRET_KEY (sk_live_… or sk_test_…)"
$STRIPE_WEBHOOK_SECRET   = Read-Host "Paste STRIPE_WEBHOOK_SECRET (whsec_…)"
$STRIPE_PRICE_SOLO       = Read-Host "Paste STRIPE_PRICE_SOLO       (price_…)"
$STRIPE_PRICE_PLUS       = Read-Host "Paste STRIPE_PRICE_PLUS       (price_…)"
$STRIPE_PRICE_BUSINESS   = Read-Host "Paste STRIPE_PRICE_BUSINESS   (price_…)"
$STRIPE_PRICE_ACCOUNTANT = Read-Host "Paste STRIPE_PRICE_ACCOUNTANT (price_…)"

# ---------------------------------------------------------------------------
# Gate 2 — Push all env vars to Vercel production scope
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[Gate 2] Push env vars to Vercel (production scope)" -ForegroundColor Yellow

if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
  Write-Host "  vercel CLI not found. Install with: npm i -g vercel" -ForegroundColor Red
  exit 1
}

$envPairs = @{
  "BETTER_AUTH_SECRET"             = $NEW_BETTER_AUTH_SECRET
  "BETTER_AUTH_URL"                = $DEPLOY_URL
  "DATA_ENCRYPTION_KEY"            = $NEW_DATA_ENCRYPTION_KEY
  "CRON_SECRET"                    = $NEW_CRON_SECRET
  "DATABASE_URL"                   = $NEW_DATABASE_URL
  "DATABASE_URL_UNPOOLED"          = $NEW_DATABASE_URL_UNPOOLED
  "RESEND_API_KEY"                 = $NEW_RESEND_API_KEY
  "TURNSTILE_SECRET_KEY"           = $NEW_TURNSTILE_SECRET_KEY
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY" = $NEW_TURNSTILE_SITE_KEY
  "AI_GATEWAY_API_KEY"             = $NEW_AI_GATEWAY_API_KEY
  "STRIPE_SECRET_KEY"              = $STRIPE_SECRET_KEY
  "STRIPE_WEBHOOK_SECRET"          = $STRIPE_WEBHOOK_SECRET
  "STRIPE_PRICE_SOLO"              = $STRIPE_PRICE_SOLO
  "STRIPE_PRICE_PLUS"              = $STRIPE_PRICE_PLUS
  "STRIPE_PRICE_BUSINESS"          = $STRIPE_PRICE_BUSINESS
  "STRIPE_PRICE_ACCOUNTANT"        = $STRIPE_PRICE_ACCOUNTANT
  "NEXT_PUBLIC_DEFAULT_LOCALE"     = "he-IL"
}

foreach ($k in $envPairs.Keys) {
  $v = $envPairs[$k]
  # `vercel env add` reads value from stdin; pipe non-interactively
  $v | vercel env add $k production --force 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  + $k" -ForegroundColor Green
  } else {
    Write-Host "  ! $k FAILED — set manually via Vercel dashboard" -ForegroundColor Red
  }
}
Write-Host ""

# ---------------------------------------------------------------------------
# Gate 6 — Apply Layer 3 migrations to production Neon
# ---------------------------------------------------------------------------
Write-Host "[Gate 6] Apply Layer 3 migrations to production Neon" -ForegroundColor Yellow

$env:DATABASE_URL_UNPOOLED = $NEW_DATABASE_URL_UNPOOLED
pnpm db:migrate
if ($LASTEXITCODE -ne 0) {
  Write-Host "  db:migrate failed — inspect output, fix, re-run script from this gate." -ForegroundColor Red
  exit 1
}
Write-Host "  Layer 3 + CoA errata + ai_conversations migrations applied." -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------------------
# Gate 4 — Resend DKIM / SPF / DMARC (DNS-side, manual)
# ---------------------------------------------------------------------------
Write-Host "[Gate 4] Resend DKIM/SPF/DMARC verification" -ForegroundColor Yellow
Write-Host "  DNS records live in docs/runbooks/email-deliverability.md."
Write-Host "  Add records to your DNS provider, then verify in Resend dashboard."
Write-Host "  Re-run this script once verified (or just check Resend → Domains)."
Write-Host ""

# ---------------------------------------------------------------------------
# Gate 5 — CPA sign-off on rules-2026.meta.json
# ---------------------------------------------------------------------------
Write-Host "[Gate 5] CPA sign-off" -ForegroundColor Yellow
$metaPath = "lib/tax/il/rules-2026.meta.json"
$meta = Get-Content $metaPath -Raw | ConvertFrom-Json
if ($meta.humanReviewed -eq $true) {
  Write-Host "  rules-2026.meta.json already signed by $($meta.reviewedBy) on $($meta.reviewedOn)" -ForegroundColor Green
} else {
  Write-Host "  Still pending CPA sign-off. Once licensed CPA reviews rules-2026.ts:"
  Write-Host "    Edit $metaPath and set:"
  Write-Host "      humanReviewed: true"
  Write-Host "      reviewedBy: '<CPA full name + license #>'"
  Write-Host "      reviewedOn: '<YYYY-MM-DD>'"
  Write-Host "    Then run: pnpm lint:rule-meta"
}
Write-Host ""

# ---------------------------------------------------------------------------
# Trigger a fresh production deploy + verify
# ---------------------------------------------------------------------------
Write-Host "Triggering fresh production deploy…" -ForegroundColor Yellow
vercel --prod --yes
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Deploy command failed. Inspect: vercel logs" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Verifying /api/auth/get-session …" -ForegroundColor Yellow
$response = curl.exe -s -o /dev/null -w "%{http_code}" "$DEPLOY_URL/api/auth/get-session"
if ($response -eq "200") {
  Write-Host "  ✓ /api/auth/get-session returns 200 — signup is live." -ForegroundColor Green
} else {
  Write-Host "  ✗ /api/auth/get-session returned $response — check vercel logs." -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Done. Visit $DEPLOY_URL/he-IL/sign-up to test the flow ===" -ForegroundColor Cyan
