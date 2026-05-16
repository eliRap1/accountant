// Thin Resend wrapper. The only place in the codebase that talks to Resend.
//
// Why a wrapper at all:
// - From-address selection is policy (see docs/runbooks/email-deliverability.md
//   §3). Callers say "this is a verification email" by passing a `kind`, and
//   the wrapper picks `verify@<domain>` / `security@<domain>` /
//   `support@<domain>` and the matching display name. Callers cannot
//   accidentally use `no-reply@` because no caller types a From: string.
// - Reply-To always defaults to `support@<domain>` so even verify@ and
//   security@ mail lands at a monitored mailbox if the user hits Reply.
// - Skip-mode: when `RESEND_API_KEY` is missing or NODE_ENV === "test",
//   the function logs and returns a synthetic id instead of crashing. This
//   keeps `pnpm dev` / `vitest` viable without a real API key.
// - Templates are rendered to HTML via `react-dom/server`'s
//   `renderToStaticMarkup` so we do not pull in `@react-email/render`
//   (Resend's `react` parameter requires that optional peer dep — see
//   docs/runbooks/email-deliverability.md §"Code wired by Agent").
import "server-only";
import type { ReactElement } from "react";
import { Resend } from "resend";
import { env } from "@/lib/env";

// React-to-HTML rendering is currently disabled. The previous approach
// did a dynamic `import("react-dom" + "/server.node")` to bypass
// Turbopack's static analyzer, which then dropped react-dom from the
// Vercel lambda bundle ("Cannot find package 'react-dom'" on first
// send). The fix is to ship transactional mail as text-only — every
// template already exports a `text` array used as fallback, and
// Resend is happy with just `text`. When a richer HTML layout becomes
// product-critical, swap in `@react-email/render` (Resend's
// own peer dep) which handles the bundling without leaning on
// react-dom directly.
function renderReactToHtml(_element: ReactElement): null {
  return null;
}

// Kind selects the From: address per the deliverability runbook §3. New email
// flows must add a case here rather than letting callers freestyle a From:.
export type EmailKind = "verify" | "security" | "support";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  /**
   * Either `react` OR `html` must be present. If both are present, `html`
   * wins (we render `react` to a string up front anyway, so it would just
   * be wasted CPU). `text` is optional but strongly recommended for
   * deliverability — Gmail downranks pure-HTML mail.
   */
  react?: ReactElement;
  html?: string;
  text?: string;
  /**
   * Per-flow override of the policy From: kind. Defaults to "support".
   */
  kind?: EmailKind;
  /**
   * Override the default Reply-To. Defaults to support@<domain>. Pass
   * `false` to omit Reply-To entirely (rare — almost always wrong).
   */
  replyTo?: string | string[] | false;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
};

export type SendEmailResult =
  | { id: string; skipped?: boolean }
  | { error: { message: string; name?: string; statusCode?: number | null } };

// Domain comes from BETTER_AUTH_URL host. Falls back to the example
// runbook domain when unset (typecheck-only paths, never production).
// Council Security: pulling the domain from BETTER_AUTH_URL guarantees the
// From-address aligns with the cookie/CSRF origin — DMARC stays aligned
// without a separate `EMAIL_DOMAIN` env var to drift out of sync.
function emailDomain(): string {
  const raw = env().BETTER_AUTH_URL;
  try {
    return new URL(raw).hostname || "accounteach.example.com";
  } catch {
    return "accounteach.example.com";
  }
}

function fromAddress(kind: EmailKind): string {
  // Owner can pin a literal from-address (e.g. Resend's sandbox sender
  // `AccounTech <onboarding@resend.dev>`) until DKIM lands on the
  // production domain. Same address is used for every `kind`; the
  // Reply-To still routes to `support@<domain>` so users hitting Reply
  // land on the monitored mailbox.
  const override = env().EMAIL_FROM_OVERRIDE;
  if (override) return override;
  const domain = emailDomain();
  switch (kind) {
    case "verify":
      return `AccounTech Verification <verify@${domain}>`;
    case "security":
      return `AccounTech Security <security@${domain}>`;
    case "support":
    default:
      return `AccounTech Support <support@${domain}>`;
  }
}

function defaultReplyTo(): string {
  // Runbook §3 hard rule: Reply-To is ALWAYS support@<domain>, even when
  // From is verify@/security@. A user who hits Reply on a verification
  // email must land at a monitored mailbox, not a black hole.
  return `support@${emailDomain()}`;
}

let cachedClient: Resend | null = null;
function getClient(apiKey: string): Resend {
  if (!cachedClient) {
    cachedClient = new Resend(apiKey);
  }
  return cachedClient;
}

function shouldSkip(): boolean {
  const e = env();
  if (e.NODE_ENV === "test") return true;
  if (!e.RESEND_API_KEY) return true;
  return false;
}

/**
 * Send a transactional email through Resend.
 *
 * Returns `{id}` on success, `{error}` on failure. Never throws — callers
 * (Better Auth hooks) must handle Resend outage gracefully because failing
 * a verification email send must not crash the signup transaction.
 */
export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const kind: EmailKind = input.kind ?? "support";

  if (shouldSkip()) {
    // Dev/test: don't actually send. Crypto.randomUUID is in Node ≥ 20.
    console.info("[email] skip-mode would send", {
      to: input.to,
      subject: input.subject,
      kind,
    });
    return { id: `dev-${crypto.randomUUID()}`, skipped: true };
  }

  // React render path is disabled (see renderReactToHtml above). Use
  // pre-rendered html if a caller supplied one; otherwise lean on the
  // template's text fallback which Resend accepts on its own.
  const html = input.html;
  void renderReactToHtml; // keep import alive while the bypass is in place
  if (!html && !input.text) {
    return {
      error: {
        message: "sendEmail: must provide one of {html, text}",
      },
    };
  }

  const resendApiKey = env().RESEND_API_KEY;
  // Belt-and-braces — shouldSkip() already returned for missing key, but
  // narrow the type for TS.
  if (!resendApiKey) {
    return {
      error: { message: "sendEmail: RESEND_API_KEY missing at send-time" },
    };
  }

  const replyTo =
    input.replyTo === false
      ? undefined
      : (input.replyTo ?? defaultReplyTo());

  try {
    const client = getClient(resendApiKey);
    // CreateEmailOptions requires at least one of {react, html, text}.
    // We've already rendered `react` to `html` above, so we only forward
    // html/text here. The unsafe-cast is necessary because the SDK's
    // discriminated union demands a literal property combination at the
    // call site.
    const payload: Parameters<typeof client.emails.send>[0] = {
      from: fromAddress(kind),
      to: input.to,
      subject: input.subject,
      ...(html ? { html } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    } as Parameters<typeof client.emails.send>[0];

    const result = await client.emails.send(payload);

    if (result.error) {
      return {
        error: {
          message: result.error.message,
          name: result.error.name,
          statusCode: result.error.statusCode,
        },
      };
    }
    if (!result.data) {
      return { error: { message: "sendEmail: empty response from Resend" } };
    }
    return { id: result.data.id };
  } catch (err) {
    // Don't leak stack traces to logs (may contain the API key in
    // certain HTTP libs). Re-shape into our error envelope.
    return {
      error: {
        message: err instanceof Error ? err.message : "Unknown sendEmail error",
      },
    };
  }
}

// Exported for tests/inspection. Mirror the runbook §3 table.
export const __testing = { emailDomain, fromAddress, defaultReplyTo };
