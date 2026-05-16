# Deployment verification — 2026-05-16

## STATUS: FAILING (env vars missing) — auth/crypto secrets not set in Vercel production

Vercel CLI authenticated as `elirap1`. Project linked.
`.vercel/project.json` written this session (`prj_4Xdyoq1TUkt2AVkJIM7ZXVasHTov`).

## Push state

| Field | Value |
|---|---|
| Pushed commits | `c3775ee` (mega-commit) + `8d26979` (synthesis docs) |
| Branch | `main` |
| Remote | `github.com/eliRap1/accountant` |

## Latest deploy snapshot

| Field | Value |
|---|---|
| Deployment ID | `dpl_GZxjUwdemSDQK6t8NnYY6YxwtP32` |
| Inspect URL | https://accountant-n7jwwvpof-elirap1s-projects.vercel.app |
| Commit | `8d26979` (matches latest push — auto-deploy fired correctly) |
| Status at check-time | **BUILDING** (will fail; same blocker as the previous 13 attempts) |
| Region | `iad1` (Washington DC — **wrong** for IL traffic; switch to `fra1` after the env fix lands) |
| Target | production |
| Created | 2026-05-16T00:56:32Z |

### History — last 13 production deploys ALL errored

Pattern: every deploy in the past ~3h failed during `next build` → "Collecting page data" → env validator throws on `/api/account/delete`. The hourly cadence of failures says the user/CI keeps re-pushing fixes that don't address the actual blocker (env vars).

The previous deploy `dpl_2LUkUdu9YHVNovDRC29dCj9qFgpM` (commit `8d26979`, 3 min before the current one) produced this exact error.

## First blocking error (verbatim from build logs)

```
Error: Invalid environment variables: {
  "BETTER_AUTH_SECRET": ["Invalid input: expected string, received undefined"],
  "BETTER_AUTH_URL":    ["Invalid input: expected string, received undefined"],
  "DATA_ENCRYPTION_KEY":["Invalid input: expected string, received undefined"]
}
  at .next/server/chunks/_0d4k~zd._.js:89:206023
> Build error occurred
Error: Failed to collect page data for /api/account/delete
Error: Command "next build" exited with 1
```

**Root cause:** `lib/env.ts` zod schema is evaluated at module init when `/api/account/delete` is statically analyzed during page-data collection. Three required vars are missing in Vercel's Production scope. One-line fix: set them.

## What IS set in Vercel production

Only Neon's auto-injected DB vars exist (added 5h ago by the Neon Vercel integration):

```
DATABASE_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL, POSTGRES_URL_NO_SSL,
POSTGRES_URL_NON_POOLING, POSTGRES_PRISMA_URL, POSTGRES_PASSWORD,
POSTGRES_USER, POSTGRES_DATABASE, POSTGRES_HOST,
PGHOST, PGHOST_UNPOOLED, PGUSER, PGDATABASE, PGPASSWORD,
NEON_PROJECT_ID, NEON_AUTH_BASE_URL, VITE_NEON_AUTH_URL
```

What's **missing** (all required boot-blockers per `lib/env.ts` + selfTest):

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `DATA_ENCRYPTION_KEY`
- `TURNSTILE_SECRET_KEY` (recommended; without it, sign-up is unprotected — and `lib/auth/selfTest.ts` step 0c **throws and refuses to boot** in NODE_ENV=production)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (same, paired)
- `TURNSTILE_SITE_KEY` (server-side reference)
- `RESEND_API_KEY` (sign-up needs email verification — without it `sendVerificationEmail` is a no-op log)

## selfTest boot-refusal hash check — STILL ARMED

`lib/auth/selfTest.ts` lines 19-24 hold SHA-256 hashes of the three chat-pasted secrets. If the owner copy-pastes the `.env.local` values straight into Vercel production, **prod will refuse to boot** with one of:

```
Secret BETTER_AUTH_SECRET matches the known-compromised value from session 2026-05-16. ...
Secret DATA_ENCRYPTION_KEY matches the known-compromised value from session 2026-05-16. ...
Secret TURNSTILE_SECRET_KEY matches the known-compromised value from session 2026-05-16. ...
```

The owner has **not yet rotated** the 3 chat-pasted secrets per `handoff.md` § SECURITY (open question #5 in handoff). Rotation is **mandatory before deploy can succeed.**

Rotation paths:

| Secret | Action |
|---|---|
| `DATABASE_URL` password | Neon dashboard → Project → Settings → Reset Password (Neon integration will update its 18 auto-injected vars; verify the new password did NOT trip the Neon-integration cache) |
| `RESEND_API_KEY` | resend.com → API Keys → revoke `re_JAJTW…` + issue new |
| `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → site `0x4AAA…` → Rotate Secret |
| `BETTER_AUTH_SECRET` | regenerate locally: `openssl rand -base64 32` (do NOT reuse the `.env.local` value — selfTest will reject it) |
| `DATA_ENCRYPTION_KEY` | regenerate locally: `openssl rand -base64 32`. **Free to rotate at this phase** (no ciphertext columns hold data yet); becomes a hard envelope-rekey job after Phase B.3 PII lands |

## Next steps for the owner — in this order

### Step 1 — rotate the three chat-pasted secrets (REQUIRED first)

```powershell
# Rotate in each console UI (see table above), then regenerate locally.
# PowerShell equivalents:
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
# Run twice — first value is the new BETTER_AUTH_SECRET, second is DATA_ENCRYPTION_KEY.
```

Update `.env.local` with the new values so local dev keeps working — **make sure `.env.local` and Vercel prod end up holding the SAME `BETTER_AUTH_SECRET` and `DATA_ENCRYPTION_KEY`** for now (until env-per-env strategy lands). Otherwise the `BETTER_AUTH_SECRET` mismatch silently invalidates every session that crosses environments.

### Step 2 — set production envs

Each `vercel env add` is interactive (prompts for value, never logs the secret).

```powershell
cd D:\accountant

# Boot-blockers (without these, build fails):
vercel env add BETTER_AUTH_SECRET production
vercel env add BETTER_AUTH_URL production            # value: https://accountant-elirap1s-projects.vercel.app  (NO trailing slash)
vercel env add DATA_ENCRYPTION_KEY production

# Required for prod boot (selfTest step 0c refuses to start without these):
vercel env add TURNSTILE_SECRET_KEY production
vercel env add NEXT_PUBLIC_TURNSTILE_SITE_KEY production
vercel env add TURNSTILE_SITE_KEY production         # same value as NEXT_PUBLIC_TURNSTILE_SITE_KEY

# Required for sign-up email flow:
vercel env add RESEND_API_KEY production

# Optional / deferred (Phase D + A.6 — skip for now):
# vercel env add AI_GATEWAY_API_KEY production
# vercel env add NEXT_PUBLIC_SENTRY_DSN production
# vercel env add SENTRY_AUTH_TOKEN production
# vercel env add NEXT_PUBLIC_POSTHOG_KEY production

vercel env ls production    # verify all 7 are present
```

### Step 3 — trigger a fresh deploy

Either push an empty commit, or:

```powershell
cd D:\accountant
vercel deploy --prod
```

Tail the build:

```powershell
vercel logs <new-deployment-url> --follow
```

Expect green inside ~3 min if envs are correct.

### Step 4 — fix the region (post-green, separate PR)

`vercel.json` is not pinning a region; the build ran in `iad1`. For IL traffic add to `vercel.json`:

```json
{ "regions": ["fra1"] }
```

Closer to Neon Frankfurt = ~5ms intra-region vs ~120ms transatlantic.

## Post-green sanity tests

Run these against the new prod URL once status flips to READY:

```powershell
$URL = "https://accountant-elirap1s-projects.vercel.app"

# Landing — expect 200
curl.exe -sS -o $null -w "%{http_code}`n" "$URL/"

# Sign-in panel — expect 200
curl.exe -sS -o $null -w "%{http_code}`n" "$URL/he/sign-in"

# Sign-up — expect 200 + Turnstile widget renders
curl.exe -sS -o $null -w "%{http_code}`n" "$URL/he/sign-up"

# Better Auth session probe — expect 200 with body {"user":null,"session":null}
curl.exe -sS "$URL/api/auth/get-session"

# Health probe via account delete route (the one that crashed during build) — expect 401 not 500
curl.exe -sS -o $null -w "%{http_code}`n" "$URL/api/account/delete" -X POST
```

If any of the above 500s, fetch runtime logs:

```powershell
vercel logs <deployment-url> --since 5m
```

## Files referenced

- `D:\accountant\lib\auth\selfTest.ts` (boot-refusal hashes, lines 19-24)
- `D:\accountant\lib\env.ts` (zod schema — single source of truth for required vars)
- `D:\accountant\docs\runbooks\vercel-env-setup.md` (canonical env list + dashboard/CLI paths)
- `D:\accountant\handoff.md` § SECURITY (rotation source list)
- `D:\accountant\.vercel\project.json` (newly written by `vercel link` this session)
