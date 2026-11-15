// Sentry Edge SDK init. Loaded from instrumentation.ts via dynamic
// import gated on `NEXT_RUNTIME === 'edge'`.
//
// Even though Next.js 16's `proxy.ts` defaults to the Node runtime (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md),
// individual Route Handlers may opt into edge via `export const runtime
// = 'edge'`, and platform adapters (Vercel) can still route some
// requests through edge. We keep the edge SDK wired up so those code
// paths still report errors.

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
  });
}
