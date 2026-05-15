// Next.js 16 boot hook. Called once per server instance before the first
// request is served. We use it to:
//   1. Gate startup on the auth/crypto/db integrity check (selfTest.ts).
//   2. Initialise the Sentry SDK appropriate to the active runtime.
//
// Edge runtime skips the selfTest because postgres-js + node:crypto rely
// on node:net / node:tls which Edge does not expose. Edge does still
// receive its Sentry init so route handlers with `runtime = 'edge'`
// report errors.

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    // Sentry first — we want startup failures from selfTest to be
    // captured if the SDK is configured.
    await import("./sentry.server.config");

    if (process.env["NODE_ENV"] !== "test") {
      const { runStartupSelfTest } = await import("@/lib/auth/selfTest");
      try {
        await runStartupSelfTest();
        console.info("[selfTest] passed");
      } catch (err) {
        console.error("[selfTest] FAILED — refusing to start:", err);
        // Re-throw so Next surfaces it as a startup error rather than a
        // silent half-broken server.
        throw err;
      }
    }
  }

  if (process.env["NEXT_RUNTIME"] === "edge") {
    await import("./sentry.edge.config");
  }
}

// Re-export Sentry's request-error hook so Next.js 16's `onRequestError`
// instrumentation contract is honoured. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
export const onRequestError = Sentry.captureRequestError;
