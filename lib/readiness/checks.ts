// Runtime self-assessment of the four owner-side production blockers.
// Surfaced via the dashboard banner so the owner can see what's still
// pending and the banner clears automatically when each gate closes.

import { env } from "@/lib/env";

export type ReadinessCheck = {
  /** Stable id used by the UI and metrics. */
  id:
    | "domain"
    | "turnstile"
    | "stripe"
    | "cpa"
    | "resend"
    | "email-override";
  /** True once the owner has resolved this gate. */
  ok: boolean;
  /** Short human label. */
  label: string;
  /** Why it's not yet ok — empty string when ok=true. */
  reason: string;
};

const CLOUDFLARE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "3x00000000000000000000FF",
]);

const RESEND_SANDBOX_FROM = "onboarding@resend.dev";

function isVercelGeneratedHost(host: string): boolean {
  return /\.vercel\.app$/.test(host);
}

export function getReadinessChecks(): ReadinessCheck[] {
  const e = env();

  // 1. Custom domain (not a *.vercel.app subdomain). Without one,
  //    Resend can never DKIM-verify the From-address.
  let host = "";
  try {
    host = new URL(e.BETTER_AUTH_URL ?? "https://placeholder.invalid").hostname;
  } catch {
    host = "";
  }
  const domainOk = Boolean(host) && !isVercelGeneratedHost(host);

  // 2. Cloudflare Turnstile production keys (not the documented test
  //    keys that always pass).
  const tsSite = e.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? e.TURNSTILE_SITE_KEY ?? "";
  const turnstileOk =
    Boolean(tsSite) && !CLOUDFLARE_TEST_SITE_KEYS.has(tsSite);

  // 3. Stripe live secret key (`sk_live_...` rather than `sk_test_...`).
  const stripeKey = e.STRIPE_SECRET_KEY ?? "";
  const stripeOk = stripeKey.startsWith("sk_live_");

  // 4. CPA sign-off — meta file must have humanReviewed=true with both
  //    a reviewer name and an ISO date. Imported dynamically so we
  //    don't pull a JSON-import into the server-component default
  //    bundle when readiness is rendered on the marketing site.
  let cpaOk = false;
  try {
    const meta =
      require("@/lib/tax/il/rules-2026.meta.json") as {
        humanReviewed?: boolean;
        reviewedBy?: string | null;
        reviewedOn?: string | null;
      };
    cpaOk = Boolean(
      meta.humanReviewed && meta.reviewedBy && meta.reviewedOn,
    );
  } catch {
    cpaOk = false;
  }

  // 5. Resend API key present at all.
  const resendOk = Boolean(e.RESEND_API_KEY);

  // 6. Email-from override OFF (override is the sandbox stop-gap that
  //    only delivers to the account-owner mailbox).
  const overrideOff = !e.EMAIL_FROM_OVERRIDE?.includes(RESEND_SANDBOX_FROM);

  return [
    {
      id: "domain",
      ok: domainOk,
      label: "Production domain",
      reason: domainOk
        ? ""
        : "BETTER_AUTH_URL still points at a *.vercel.app host — buy a real domain, point its DNS at the project.",
    },
    {
      id: "resend",
      ok: resendOk,
      label: "Resend API key",
      reason: resendOk ? "" : "RESEND_API_KEY missing — transactional email is disabled.",
    },
    {
      id: "email-override",
      ok: overrideOff,
      label: "Live mail sender",
      reason: overrideOff
        ? ""
        : "EMAIL_FROM_OVERRIDE is on (sandbox sender) — mail only reaches the Resend account owner.",
    },
    {
      id: "turnstile",
      ok: turnstileOk,
      label: "Turnstile (real keys)",
      reason: turnstileOk
        ? ""
        : "Turnstile keys are Cloudflare's documented test keys — every captcha passes; bot traffic unprotected.",
    },
    {
      id: "stripe",
      ok: stripeOk,
      label: "Stripe live mode",
      reason: stripeOk
        ? ""
        : "STRIPE_SECRET_KEY is in test mode (sk_test_…) — real card charges blocked.",
    },
    {
      id: "cpa",
      ok: cpaOk,
      label: "CPA sign-off",
      reason: cpaOk
        ? ""
        : "rules-2026.meta.json: humanReviewed:false — /tax engines must not face paying users yet.",
    },
  ];
}

export function getPendingReadinessChecks(): ReadinessCheck[] {
  return getReadinessChecks().filter((c) => !c.ok);
}

export function isProductionReady(): boolean {
  return getReadinessChecks().every((c) => c.ok);
}
