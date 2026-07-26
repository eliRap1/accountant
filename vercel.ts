import { routes, type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "next build",
  // Project is pnpm-only (packageManager pin + pnpm-lock.yaml committed).
  // Without this override Vercel auto-detects npm, which then conflicts
  // with the pnpm-lock schema and fails the build.
  installCommand: "pnpm install --frozen-lockfile",
  outputDirectory: ".next",

  // Frankfurt — same continent as our Neon `eu-central-1` cluster, and
  // ~150 ms closer to Israeli users than the default `iad1` (Washington
  // DC). Cross-Atlantic round-trips on every server-side DB query used
  // to dominate p95; pinning Serverless Functions to the DB region
  // collapses that path. `regions` is the canonical field on
  // `VercelConfig` (`@vercel/config/v1`).
  regions: ["fra1"],

  crons: [
    // Nightly account-purge sweep — destroys DEKs for users past their
    // 30-day post-soft-delete grace window (Plan v4 Risk #7, IL Privacy
    // Law Amendment 13 right-of-erasure reconciled with Income Tax
    // Ordinance § 130 7-year retention via cryptographic erasure).
    // 03:00 UTC = 06:00 Asia/Jerusalem — off-peak, after the daily
    // backup runs (the backup-daily cron at 03:17 UTC remains the
    // upstream archival step before any retention sweep).
    { path: "/api/cron/account-purge", schedule: "0 3 * * *" },
    // Morning Tax Brief — the product's killer feature (Product council
    // pick, docs/council/2026-05-16-product-review.md §7). Daily 06:00
    // UTC = 08:00 Asia/Jerusalem in winter / 09:00 in summer. The 1-hour
    // DST drift is an accepted MVP trade-off; running two cron entries
    // is more operational complexity than the daily habit goal needs.
    // The brief is deterministic (NO AI calls); cost is dominated by
    // Resend transactional sends.
    { path: "/api/cron/morning-brief", schedule: "0 6 * * *" },
    // Processor-sync daily sweep (Plan v4 Phase F.4). Pulls receipts
    // from every active processor_sync_credentials row, pairs them
    // with existing internal invoices, and surfaces orphans on the
    // /processor-sync page. Scheduled at 04:17 UTC = 07:17
    // Asia/Jerusalem — after account-purge (03:00) finishes and
    // before the morning-brief (06:00) compiles the daily snapshot.
    // Vercel Hobby tier caps crons at daily granularity; upgrade to
    // Pro to restore hourly cadence for live processor APIs.
    { path: "/api/cron/processor-sync", schedule: "17 4 * * *" },
  ],

  headers: [
    routes.cacheControl("/_next/static/(.*)", {
      public: true,
      maxAge: "1 year",
      immutable: true,
    }),
    routes.cacheControl("/(.*\\.(?:woff2|woff|ttf|otf|eot))", {
      public: true,
      maxAge: "1 year",
      immutable: true,
    }),
    routes.cacheControl("/(.*\\.(?:png|jpg|jpeg|webp|avif|svg|ico|gif))", {
      public: true,
      maxAge: "30 days",
    }),
    {
      source: "/(.*)",
      headers: [
        // TODO(audit): add Content-Security-Policy header once inline-style / canvas requirements are mapped
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ],
    },
  ],
};

export default config;
