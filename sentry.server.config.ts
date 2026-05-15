// Sentry Node.js SDK init. Loaded from instrumentation.ts via dynamic
// import gated on `NEXT_RUNTIME === 'nodejs'`.
//
// Boot-time gate: skip init when DSN is missing so dev without an
// observability stack works.

import * as Sentry from "@sentry/nextjs";
import { sanitizeEvent } from "@/lib/observability/redaction";

const dsn = process.env["NEXT_PUBLIC_SENTRY_DSN"];

if (dsn) {
  const isProd = process.env.NODE_ENV === "production";

  Sentry.init({
    dsn,
    tracesSampleRate: isProd ? 0.1 : 1.0,
    beforeSend: sanitizeEvent,
    sendDefaultPii: false,
    // Sentry's Node SDK auto-instruments `postgres-js` via the
    // `postgresIntegration` that ships with the default integration set
    // (see @sentry/node-core). We rely on that default; no manual
    // wrapping needed.
  });
}
