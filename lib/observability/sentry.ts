// Thin wrapper over `@sentry/nextjs` so application code never imports
// the SDK directly. This keeps three concerns local:
//   1. A single audit point for what gets reported / how.
//   2. Sane no-op behavior when DSN is missing (dev / preview without
//      secrets).
//   3. A `withSentry` HOC that wraps App Router route handlers in an
//      `isolationScope` so each request's user context, tags, and
//      breadcrumbs don't bleed into the next one.

import * as Sentry from "@sentry/nextjs";

type CaptureContext = {
  /** Tags surface in the Sentry UI as searchable filters. */
  tags?: Record<string, string | number | boolean>;
  /** Free-form extra payload, attached to the event under `extra`. */
  extra?: Record<string, unknown>;
  /** Stable user identifier — never email/PII, just the internal id. */
  userId?: string;
};

/**
 * Capture a caught error. Safe to call when Sentry is not initialized —
 * it just becomes a noop. We strip email/PII either way because the
 * global `beforeSend` hook (see `lib/observability/redaction.ts`)
 * applies before the event leaves the process.
 */
export function captureException(err: unknown, ctx?: CaptureContext): void {
  Sentry.withScope((scope) => {
    if (ctx?.tags) {
      for (const [key, value] of Object.entries(ctx.tags)) {
        scope.setTag(key, value);
      }
    }
    if (ctx?.extra) {
      for (const [key, value] of Object.entries(ctx.extra)) {
        scope.setExtra(key, value);
      }
    }
    if (ctx?.userId) {
      scope.setUser({ id: ctx.userId });
    }
    Sentry.captureException(err);
  });
}

/**
 * Attach the current user id to subsequent events. Pass `null` to clear
 * the binding (e.g. on sign-out). We never store email/IP here —
 * `redaction.ts` would strip them anyway.
 */
export function setUserContext(userId: string | null): void {
  if (userId === null) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: userId });
}

/**
 * Higher-order wrapper for App Router route handlers. Runs the handler
 * inside a dedicated isolation scope so per-request user/tag state
 * does not leak across requests in the same Node worker.
 *
 * Usage:
 *   export const POST = withSentry(async (req) => { ... });
 */
export function withSentry<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R> | R,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    return Sentry.withIsolationScope(async () => {
      try {
        return await fn(...args);
      } catch (err) {
        captureException(err, { tags: { handler: "withSentry" } });
        throw err;
      }
    });
  };
}
