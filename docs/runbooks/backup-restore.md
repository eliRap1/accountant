# Backup + Restore Runbook — Neon → encrypted Vercel Blob

> Status: planned. No script lands until Phase A.6 (operational surface). This document
> defines the operating model the script must implement and the people-procedure that
> wraps it.

---

## 1. Why this exists

Three independent reasons stack:

1. **Israeli tax law mandates 7-year retention** of bookkeeping records, including
   invoices and filings (Income Tax Ordinance § 130 + Income Tax Regulations
   (Bookkeeping) 1973). A 30-day database point-in-time-restore window does not
   satisfy this on its own — we must hold a discoverable archive that survives
   far longer than the database PITR window.
2. **Neon PITR is bounded.** Verified 2026-05-16 against
   <https://neon.com/docs/introduction/point-in-time-restore>:
   - Free plan: **6 hours** of history.
   - Launch plan: configurable up to **7 days**.
   - Scale plan: configurable up to **30 days**.
   - Business plan: not documented in the public PITR page — `<verify-this>`
     before we upgrade past Scale.
   Even on Scale, we lose anything older than 30 days unless we ship our own
   archive.
3. **Cross-provider disaster recovery.** A complete Neon-account loss (billing
   dispute, account takeover, regional outage that exceeds Neon's SLA) leaves us
   with zero data if our only copy is inside Neon. The off-Neon archive lives in
   Vercel Blob, which is on a different vendor's auth boundary and a different
   region. Recovery is slower than Neon PITR, but it is **independent**.

---

## 2. Backup architecture

### 2.1. What gets backed up

- The entire `public` schema of the **production** Neon branch (initially the
  default branch; once we move to env-per-branch we will dump prod only).
- All Better Auth tables + every app table that ships in Phase A onward.
- Excludes: nothing for now. (When `auth_events` grows large enough to dominate
  the dump, we revisit — but until then a single `pg_dump` is simpler than
  selective dumps.)

### 2.2. Connection — unpooled only

`pg_dump` MUST connect through the **unpooled** Neon endpoint
(`DATABASE_URL_UNPOOLED`). The pooled endpoint runs pgbouncer in transaction
mode, which does not support prepared statements or the long-running
`COPY (...) TO STDOUT` stream `pg_dump` uses internally. `db/client.ts` already
exposes the same split — `dbService` uses the unpooled URL for migrations and
crons; backups follow the same rule.

### 2.3. Encryption at rest — envelope, with versioned KEK

Plaintext SQL dumps never touch disk and never touch Vercel Blob. The cron:

1. Reads `DATA_ENCRYPTION_KEY` from env (32 raw bytes, base64-encoded — same
   var `lib/security/kek.ts` validates on boot). This is the current **KEK**.
2. Generates a fresh 32-byte **DEK** per dump.
3. Encrypts the dump stream with `crypto.createCipheriv('aes-256-gcm', dek, iv)`
   where `iv = crypto.randomBytes(12)`. Reads the GCM auth tag at finalize.
4. Wraps the DEK by encrypting it under the KEK and inserts a row into
   `data_encryption_keys` with `purpose = 'backup.daily'` (or
   `'backup.monthly'`), `kek_version = <current>`, `created_at = now()`,
   `retired_at = NULL`. This is the same envelope pattern Plan v4 § Risk #6
   defines for PII columns.
5. Writes a small JSON sidecar with `{ dek_row_id, iv_b64, auth_tag_b64,
   kek_version, schema_version, dump_started_at, dump_finished_at,
   pg_dump_args }` next to the ciphertext blob.

The KEK never travels with the backup. Without `data_encryption_keys` (held in
Postgres) **and** the KEK (held in Vercel env), the encrypted blob is useless.

### 2.4. Storage — Vercel Blob, private store

- Store kind: **private**. Reads go through a Vercel Function, never a public
  CDN URL — verified 2026-05-16 against
  <https://vercel.com/docs/vercel-blob/usage-and-pricing> ("private blob
  delivery: Your Function fetches the blob from the store, then streams it to
  the browser").
- Daily key pattern: `backups/daily/${YYYY-MM-DD}.sql.enc` (UTC date — pick a
  TZ once and never change it; UTC avoids DST drift).
- Monthly snapshot key pattern: `backups/monthly/${YYYY-MM}.sql.enc` (the first
  of each month is moved here from `backups/daily/` rather than re-dumped, so
  the bytes are identical).
- Sidecar JSON key pattern: same path, suffix `.meta.json`.
- The store must NOT be browsable from the dashboard during normal operations
  — dashboard interactions count as Advanced Operations and add cost.

### 2.5. Schedule — Vercel Cron entry

In `vercel.ts` `crons[]`:

```ts
// vercel.ts (planned; do not commit until Phase A.6)
{
  path: "/api/cron/backup-daily",
  // 03:17 UTC = 05:17 / 06:17 IL (DST aware) — off-peak, avoids midnight
  //   churn, avoids on-the-hour cron stampedes shared with everyone else
  schedule: "17 3 * * *",
},
```

The route handler lives at `app/api/cron/backup-daily/route.ts`. The actual work
runs out-of-process in `scripts/cron-backup.ts` so it can be exercised locally
(`pnpm tsx scripts/cron-backup.ts`) without booting Next. The route is a thin
shell that spawns the script and writes a row to `auth_events`
(`event_type = 'backup.daily.started' | 'backup.daily.completed' |
'backup.daily.failed'`).

Vercel Cron auth header: the route MUST reject any invocation whose
`Authorization` header doesn't match `CRON_SECRET`. Per Vercel's cron docs the
platform sets this header automatically.

Run duration: a full dump on a 5–10 GB DB typically completes in 3–6 min.
Fluid Compute's ~300 s default function timeout applies to the route handler,
not the child process. The script's `child_process.spawn` for `pg_dump` runs in
the function and DOES count — if dump time approaches the limit, we move the
script to a **standalone cron host** (Fly machine, GitHub Actions on
`schedule:`, or external scheduler that hits a long-running endpoint). See
§ 7 (a) below.

### 2.6. Shell script skeleton — `scripts/cron-backup.ts`

Skeleton, NOT code. To be written in Phase A.6 against the verified Node 24
LTS `child_process.spawn` API.

- Spawns `pg_dump --no-owner --no-acl --format=plain --dbname=$DATABASE_URL_UNPOOLED`.
- `--no-owner --no-acl` so a restore into a Neon branch with a different
  `neondb_owner` doesn't fail on `ALTER OWNER TO`.
- `--format=plain` — keeps the dump streamable for the GCM cipher. (`--format=custom`
  is faster to restore but cannot stream cleanly through `Cipher` without
  `--file=`.)
- Streams stdout → `Cipher` → `@vercel/blob put()` → resolves the URL.
- On `pg_dump` non-zero exit: log + insert `auth_events` row + throw. Never
  upload a partial blob; if upload happens before pg_dump finishes, the blob
  is incomplete and we must `del()` it.
- On success: insert a `data_encryption_keys` row (for the DEK) and a sidecar
  blob (for IV + auth tag + meta).

### 2.7. Why not just `pg_dump | gzip | base64 | curl`?

- Plain `gzip` is not encryption. A leaked blob (misconfigured store, support
  ticket attachment, etc.) is plaintext SQL.
- `gpg --symmetric` would work but adds a system binary dependency we don't
  otherwise need. AES-256-GCM via Node `crypto` is the same primitive we use
  for column encryption — one less thing to audit.
- We DO gzip *before* encrypting (compresses well; encryption defeats gzip).
  Stream order: `pg_dump → gzip → aes-256-gcm → vercel-blob`.

---

## 3. Retention policy

| Track   | Source                     | Path                            | Auto-delete |
|---------|----------------------------|---------------------------------|-------------|
| Daily   | nightly cron               | `backups/daily/YYYY-MM-DD.sql.enc` | Yes, at 30 days |
| Monthly | promoted from day-1's daily | `backups/monthly/YYYY-MM.sql.enc`  | **No** — held 7 years minimum |

### Rules — authoritative

1. **Daily rotation.** The same cron that produces today's dump deletes any
   daily blob whose date is older than `today - 30 days`. We pick 30 days to
   cover the Neon Scale PITR window with one extra full off-Neon copy at the
   end, so the daily track is genuinely additive coverage and not duplicative.
2. **Monthly promotion.** On the **1st of each calendar month** (UTC), after
   the daily dump succeeds, the cron **copies** that blob from
   `backups/daily/YYYY-MM-01.sql.enc` to `backups/monthly/YYYY-MM.sql.enc`
   (cheap — `@vercel/blob copy()`, one Advanced Operation). The 30-day rotation
   then removes the daily copy 30 days later as normal. The monthly copy
   persists.
3. **Monthly retention.** Minimum **7 years (84 months)** to align with the IL
   Income Tax Ordinance § 130 retention rule on bookkeeping records (covers
   invoices, journal entries, filings, payroll). Practically: **delete only
   manually**, never via cron. A separate annual review confirms which
   monthlies are still in scope.
4. **Never delete on PII-deletion requests.** When a user exercises Privacy
   Law deletion rights, we soft-delete in the live DB and destroy the DEK row
   for that user's PII columns (Plan v4 Risk #7 — DEK destruction redacts the
   ciphertext in-place). The historical backups are not rewritten; they
   contain ciphertext that is now undecryptable because the wrapped DEK in
   `data_encryption_keys` for that user has been retired and the wrap key
   destroyed. This is the documented redaction mechanism. **A purge sweep
   against historical backups would itself violate the tax-record retention
   rule** — the records must be retained as written; the PII inside them is
   redacted via cryptographic erasure, not by deleting the dump file.
5. **Restore drills do not consume retention.** Drill artifacts (test
   branches, scratch blobs) are deleted explicitly when the drill ends; they
   are not part of the retention count.

### 7-year math vs cost note

84 monthly snapshots × ~10 GB-each-compressed-encrypted ≈ 840 GB.
At Vercel Blob private $0.023/GB-month (verified 2026-05-16 from the pricing
example in <https://vercel.com/docs/vercel-blob/usage-and-pricing>; Pro
includes 5 GB), that's an asymptotic ~$19/month for storage alone, plus
~$5 advanced ops + restore-test transfer. The break-even versus our own S3
bucket (≈ $0.023/GB-month + $0.005/1K PUT) is months — Vercel Blob wins on
operational simplicity until the archive crosses ~5 TB.

---

## 4. Restore procedure

> **Iron rule: never restore directly to production.** Restore into a new Neon
> branch first, validate, then promote (or copy specific rows back) under a
> change-management window.

### 4.1. Identify which blob

- Production incident at known time `T`:
  - First reach for Neon PITR (faster, no decryption). Use only if `T` falls
    inside the active history window.
  - Otherwise pull the nearest preceding monthly snapshot from `backups/monthly/`.
- Audit / e-discovery / tax-authority request for date `D`:
  - Pull the monthly snapshot for the month containing `D`. Daily blobs are
    rotated out; only the monthly track satisfies long-tail requests.

### 4.2. Pull the encrypted blob locally

```powershell
# Pull the ciphertext + sidecar
npx vercel blob get "backups/monthly/2025-12.sql.enc"      -o .\restore\
npx vercel blob get "backups/monthly/2025-12.sql.enc.meta.json" -o .\restore\
```

(Verify CLI subcommand name against `npx vercel blob --help` before running —
the SDK is preferred; the CLI surface here is `<verify-this>` and may be
`vercel blob download` instead. Don't paste-from-memory.)

### 4.3. Find the right KEK version

Read `kek_version` from the sidecar. If it matches the current
`DATA_ENCRYPTION_KEY` in env, decrypt directly. If it doesn't, we are in a
**post-KEK-rotation restore** — see § 7 (c).

### 4.4. Unwrap the DEK and decrypt

The wrapped DEK lives in `data_encryption_keys.wrapped_dek_bytea` keyed by the
sidecar's `dek_row_id`. Run a one-shot Node script (sketched, not committed)
that:

1. Reads the env KEK at the version pinned in the sidecar.
2. Selects the wrapped DEK row (`SELECT wrapped_dek_bytea, retired_at FROM
   data_encryption_keys WHERE id = $1`). If `retired_at IS NOT NULL` and the
   row's wrapping key has been destroyed, abort — the blob is now
   cryptographically redacted. This is the intentional Plan v4 Risk #7
   behaviour, not a bug.
3. Unwraps to recover the raw DEK.
4. Streams `Cipher` in `decipher` mode with the sidecar's IV + auth tag.
5. Pipes through `gunzip` → SQL stream.

### 4.5. Restore into a Neon branch — never prod

```powershell
# Create a fresh branch off main for the restore test. Branch name encodes the date.
neonctl branches create --name "restore-test-$(Get-Date -Format yyyy-MM-dd)"

# Get the unpooled connection string for the new branch
$RESTORE_URL = neonctl connection-string restore-test-2025-12-15 --pooled false

# Pipe decrypted SQL into psql, against the BRANCH, not prod.
gc .\restore\dump.sql | psql $RESTORE_URL
```

(Verify `neonctl` subcommand syntax against `neonctl --help` — recent versions
have shuffled flags. `<verify-this>` before relying on the exact wording.)

### 4.6. Validate before doing anything else

- Row count parity per table against a known-good live snapshot:
  `SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 1`.
- Run the **RLS regression test suite** (Plan v4 Phase A.7) against the
  branch URL. Any RLS regression caught here is grounds to NOT promote.
- Spot-check encrypted columns by attempting a known-good decrypt against
  a few rows — confirms `data_encryption_keys` is intact in the restored
  copy.
- Verify Better Auth user count + `auth_events` tail.

### 4.7. Promote (or don't)

- If the restore is for an audit / read-only ask: extract what's needed,
  delete the branch with `neonctl branches delete restore-test-...`. Done.
- If the restore is to RECOVER prod: a separate change-management decision.
  Typical path: make the restored branch the new primary via Neon's branch
  reset, NOT `pg_restore` over prod. Document the decision in
  `docs/adr/` with the deciding human's name. **No agent makes this call
  alone.**

---

## 5. Quarterly restore drill

A backup that has never been restored is not a backup. Calendar reminder:
**1st business day of each quarter**, owner = whoever is on-call ops that
week (initially the user; later the team).

### Drill checklist — paste into the ticket

- [ ] Pull the latest monthly snapshot (`backups/monthly/YYYY-MM.sql.enc`).
- [ ] Decrypt locally (validates KEK chain works end-to-end).
- [ ] Create branch `drill-${YYYY-Q}-${dateStamp}`.
- [ ] Restore decrypted SQL into the branch.
- [ ] Run the full RLS regression suite + the encryption round-trip golden
      tests against the branch URL.
- [ ] Validate row counts match the source dump's `pg_dump` log.
- [ ] Time the end-to-end procedure. Record in this runbook's "drill log"
      table below — slow drills mean future-incident MTTR is slow.
- [ ] Decommission: `neonctl branches delete drill-...`.
- [ ] Close the ticket. If anything failed, file a follow-up issue tagged
      `runbook:backup-restore`.

### Drill log (append after each run)

| Quarter | Date | Snapshot pulled | Wall-clock min | Result | Notes |
|---------|------|-----------------|----------------|--------|-------|
| _none yet_ |  |  |  |  | First drill due after Phase A.6 ships the cron. |

---

## 6. Failure modes

### (a) `pg_dump` times out on a large DB

Symptoms: function hits the ~300 s Fluid Compute timeout; the route handler
returns 504; `auth_events` shows `backup.daily.started` but no `.completed`.

What to do:

1. Stop relying on the route handler for the long-running spawn. Move the
   dump to a **non-Vercel scheduler** — either GitHub Actions on `schedule:`,
   a Fly machine with a Postgres + Node toolchain, or a small DO droplet. The
   script remains `scripts/cron-backup.ts`; only the trigger moves.
2. Until the move lands, switch the daily cron to `pg_dump --format=custom`
   with parallel jobs (`-j 4`) — but custom format means the cipher needs an
   intermediate file, which means a tempfs mount. Not feasible on Vercel
   Functions. The right answer is the move.
3. Open an ADR: "backup cron runs on $external_scheduler because pg_dump
   exceeded Fluid Compute timeout" — write down the trade-off before the
   move so future-us doesn't reverse it without reading.

### (b) Vercel Blob is down

Symptoms: `@vercel/blob put()` returns 5xx; cron throws.

What to do:

1. Cron is idempotent on key collision (same date = same key); a retry the
   next hour overwrites and re-succeeds. Wire a one-shot retry in
   `scripts/cron-backup.ts` BEFORE assuming the outage. Backoff: 5 min, 15
   min, 60 min. If all fail: alert + skip — do not block the function
   indefinitely.
2. Confirm outage at <https://www.vercel-status.com/>.
3. If the outage is hours long, fall back to **manual dump locally**:
   `pnpm tsx scripts/cron-backup.ts --output-dir=./local-backup` (planned
   flag — `<verify-this>` against the actual script when it lands). Upload
   when Blob recovers; rename to today's date.
4. File a paging incident if a full daily slot is missed — the
   `data_encryption_keys` row is then orphaned without a blob; clean it up
   manually so the restore-time check doesn't trip on it.

### (c) KEK has been rotated and old backup can't decrypt

Symptoms: at restore time, the sidecar's `kek_version` is older than the
current env KEK; the unwrap fails with `BadAuthTag`.

What to do:

1. **Don't panic, don't destroy anything.** A rotation procedure that
   couldn't decrypt yesterday's backup is a broken rotation procedure — fix
   the procedure, not the backup.
2. KEK rotation is supposed to record the **old** KEK in a secrets
   archive (1Password / Vercel env at a versioned name like
   `DATA_ENCRYPTION_KEY_V2`) with a `retired_at` timestamp. The runbook for
   KEK rotation (separate doc — TODO when we first rotate) MUST cover this.
3. Pull the old KEK value from the archive. Set it temporarily in the local
   decrypt script's env (NOT in production env). Decrypt. Re-encrypt the
   restored data under the new KEK once it's loaded into a Neon branch.
4. If the old KEK is genuinely lost (no archive entry): the backup is
   cryptographically destroyed. This is the same redaction we deliberately
   use for PII deletion. For backups that's a data-loss event — escalate
   to the founder.

### (d) `data_encryption_keys` table has been truncated or corrupted

Symptoms: sidecar references `dek_row_id` that doesn't exist in the restore's
prod copy.

What to do: the live prod DB has the row even though the dump file doesn't
(if the dump was taken before that row was inserted, but the row IS the wrap
of the DEK for the dump itself, which is a contradiction — so this only
happens if `data_encryption_keys` was deleted from prod). Recover by
restoring `data_encryption_keys` from a more recent backup first, then
restoring the rest of the data.

---

## 7. Cost vs running our own S3

| Track                     | Vercel Blob private (verified 2026-05-16) | Our-own S3 (eu-central-1 estimate) |
|---------------------------|--------------------------------------------|------------------------------------|
| Storage / GB-month        | **$0.023** (5 GB included on Pro)          | $0.023 standard, $0.0125 IA, $0.004 Glacier IR |
| Advanced Op / 1M          | **$5.00** (10K included)                   | $5.40 PUT/COPY                     |
| Simple Op / 1M            | **$0.40** (100K included)                  | $0.43 GET                          |
| Data transfer out / GB    | **~$0.05** (region-dependent; 100 GB included) | $0.09 to internet (first 10 TB)    |
| Operational glue          | One `npx vercel blob put`                  | Bucket + IAM + lifecycle policy + KMS — multi-day setup |

**Decision:** stay on Vercel Blob until the monthly archive crosses ~5 TB
(~50 years of monthlies at current scale, i.e. never). Re-evaluate if AWS
cuts long-term storage prices below $0.005/GB-month, which would tilt
Glacier Deep Archive into clearly cheaper territory for the 7-year monthlies.

Verified facts and their sources:
- Vercel Blob price components — pricing example at
  <https://vercel.com/docs/vercel-blob/usage-and-pricing>, fetched
  2026-05-16. The page does not surface per-resource $/unit in a single
  table; the numbers in the table above are derived from the worked example
  ("45 GB extra at $0.023/GB", "650K extra at $0.40/1M", "326K extra at
  $5.00/1M", "250 GB extra at $0.05/GB").
- Neon PITR windows per tier — <https://neon.com/docs/introduction/point-in-time-restore>,
  fetched 2026-05-16. Business tier value is `<verify-this>` (page does not
  enumerate it).

---

## 8. Things this runbook does NOT cover (yet)

- **Logical replica to a third party** (Fly Postgres, a colo'd reader). Out of
  scope for Phase A; revisit at the first compliance audit ask.
- **WAL archive to Blob** for sub-day RPO. Neon PITR covers this until
  Scale-tier 30-day window is exhausted; a continuous WAL archive doubles
  cost and complexity. Skip until customer SLA demands it.
- **KEK rotation procedure.** Separate runbook needed. Tracker:
  `docs/runbooks/key-rotation.md` does not yet exist.
- **Snapshot tagging for tax-year boundaries.** When the IL tax year ends
  (Dec 31), we want a "fiscal year close" snapshot tagged distinctly from the
  Dec monthly. Out of scope until Phase D ships year-end closes.

End of runbook.
