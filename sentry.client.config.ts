// Sentry browser SDK init.
//
// File name kept as `sentry.client.config.ts` per project brief. Sentry's
// Next.js 16 SDK still bundles this file when present (see
// node_modules/@sentry/nextjs/build/cjs/config/webpack.js — webpack rule
// matches `sentry.client.config.(jsx?|tsx?)|instrumentation-client.(js|ts)`).
// A deprecation warning is emitted at build time encouraging migration to
// `instrumentation-client.ts`; we accept that for now since it does not
// affect runtime behavior.
//
// Boot-time gate: when DSN is missing (dev / local CI / preview without
// secrets) we skip init entirely so the SDK does not throw.

import * as Sentry from "@sentry/nextjs";
import { sanitizeEvent } from "@/lib/observability/redaction";

const dsn = process.env["NEXT_PUBLIC_SENTRY_DSN"];

if (dsn) {
  const isProd = process.env.NODE_ENV === "production";

  Sentry.init({
    dsn,
    // 100% traces in dev so we can see them; 10% in prod to keep cost down.
    tracesSampleRate: isProd ? 0.1 : 1.0,
    // Session Replay: never sample sessions on their own — only spin up a
    // replay when an error actually fires, and even then only 10% of the
    // time. Keeps the bundle from streaming user video by default.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    // PII redactor — see lib/observability/redaction.ts. We apply the
    // same shape on client / server / edge so the rules are auditable in
    // one place.
    beforeSend: sanitizeEvent,
    // Sentry 10's React SDK opts out of sending the user's IP / email by
    // default unless you set `sendDefaultPii: true`. We keep the default
    // (false) but say so explicitly so future readers do not assume.
    sendDefaultPii: false,
  });
}

// Re-export router transition hook so `instrumentation-client.ts` (if we
// ever add one) can wire navigation breadcrumbs. Not used at the moment.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
