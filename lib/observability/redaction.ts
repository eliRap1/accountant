// Sentry `beforeSend` event sanitizer.
//
// Rules (per project brief):
//  1. Strip `email` keys nested anywhere inside `request.headers`,
//     `user.email`, `extra.*`.
//  2. Strip query strings from `request.url` — keep only the pathname.
//  3. Strip cookies entirely.
//  4. Drop events tagged `ignored: true`.
//
// The same callback shape works on browser, Node, and Edge so we share
// one implementation across `sentry.{client,server,edge}.config.ts`.

import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const EMAIL_KEY_RE = /(^|[._-])email($|[._-])/i;

function stripEmailKeys(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (EMAIL_KEY_RE.test(key)) {
      delete obj[key];
    }
  }
}

function stripQueryString(url: string): string {
  try {
    // URL constructor needs a base for path-only inputs; fall back to a
    // sentinel so we can still parse `/path?foo=bar`.
    const parsed = new URL(url, "http://_sentinel.invalid");
    if (parsed.hostname === "_sentinel.invalid") {
      return parsed.pathname;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Anything we can't parse, return un-querystringed best-effort.
    const idx = url.indexOf("?");
    return idx === -1 ? url : url.slice(0, idx);
  }
}

export function sanitizeEvent(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  // Rule 4 — short-circuit on the ignored tag.
  if (event.tags && event.tags["ignored"] === true) {
    return null;
  }

  // Rule 3 — cookies are always sensitive; drop them outright.
  if (event.request?.cookies) {
    delete event.request.cookies;
  }

  // Rule 1 — emails under request.headers.
  if (event.request?.headers) {
    stripEmailKeys(event.request.headers as Record<string, unknown>);
  }

  // Rule 1 — user.email.
  if (event.user) {
    // `User` from @sentry/core declares `email?: string`, so this is
    // both type-safe and matches the runtime shape we want to redact.
    delete event.user.email;
    // Also drop the explicit IP if present — pairs with sendDefaultPii=false
    // but defends against integrations that set it after the init guard.
    delete event.user.ip_address;
  }

  // Rule 1 — emails buried in `extra`.
  if (event.extra) {
    stripEmailKeys(event.extra as Record<string, unknown>);
  }

  // Rule 2 — keep pathname, drop query string.
  if (event.request?.url) {
    event.request.url = stripQueryString(event.request.url);
  }
  if (event.request?.query_string) {
    delete event.request.query_string;
  }

  return event;
}
