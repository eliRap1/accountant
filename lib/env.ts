import { z } from "zod";

const isProduction = process.env["NODE_ENV"] === "production";

// Treat empty strings as "absent" for any optional field so .env.local
// placeholders (e.g. `RESEND_API_KEY=`) don't trip min(1) validators.
// .optional() lives inside the inner schema so undefined inputs pass
// through cleanly in Zod v4 (chaining .optional() on a ZodEffects does
// not short-circuit the inner validator for undefined).
const optionalNonEmpty = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

const schema = z.object({
  // Runtime
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database (Neon Postgres, Frankfurt)
  DATABASE_URL: z.string().url(),
  DATABASE_URL_UNPOOLED: z.string().url(),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),

  // Encryption (AES-256-GCM key, base64-encoded 32 bytes)
  DATA_ENCRYPTION_KEY: z.string().min(40),

  // Transactional email (Resend)
  RESEND_API_KEY: optionalNonEmpty,
  // Optional sender override. When set, replaces the
  // `verify@<host>` / `security@<host>` / `support@<host>` triple with
  // a single literal address — e.g. `AccounTech <onboarding@resend.dev>`
  // for sandbox-only sends before DKIM lands. Display name is honoured.
  EMAIL_FROM_OVERRIDE: optionalNonEmpty,

  // CAPTCHA (Cloudflare Turnstile). Site key duplicated as NEXT_PUBLIC_*
  // so client code can read it without it leaking through the server-only
  // env() reader. Server still validates the legacy TURNSTILE_SITE_KEY.
  TURNSTILE_SITE_KEY: optionalNonEmpty,
  TURNSTILE_SECRET_KEY: optionalNonEmpty,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalNonEmpty,

  // AI Gateway / OpenAI
  AI_GATEWAY_API_KEY: optionalNonEmpty,
  AI_MODEL: z.string().default("openai/gpt-5.4-mini"),
  AI_ESCALATION_MODEL: z.string().default("openai/gpt-5.4"),

  // Observability
  NEXT_PUBLIC_SENTRY_DSN: optionalNonEmpty,
  SENTRY_AUTH_TOKEN: optionalNonEmpty,
  NEXT_PUBLIC_POSTHOG_KEY: optionalNonEmpty,
  NEXT_PUBLIC_POSTHOG_HOST: z.string().default("https://eu.i.posthog.com"),

  // Vercel Cron shared secret. Cron handlers verify the
  // `Authorization: Bearer ${CRON_SECRET}` header that Vercel
  // auto-injects when the platform invokes a scheduled function.
  // Optional in dev (handlers fall back to allowing unauthenticated
  // local invocation), required in production.
  CRON_SECRET: optionalNonEmpty,

  // Stripe billing (Phase F.1). All optional so dev / staging can run
  // without Stripe configured — the lib/billing layer throws a clear
  // "Stripe not configured" error if a route hits it without keys.
  // Secret + webhook secret are server-only; publishable is mirrored to
  // NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY for the browser SDK.
  // Per-plan price IDs come from STRIPE_PRICE_<PLAN_UPPER> envs (resolved
  // dynamically in lib/billing/plans.ts so adding/removing tiers does
  // not require an env schema change here).
  STRIPE_SECRET_KEY: optionalNonEmpty,
  STRIPE_PUBLISHABLE_KEY: optionalNonEmpty,
  STRIPE_WEBHOOK_SECRET: optionalNonEmpty,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalNonEmpty,
  STRIPE_PRICE_SOLO: optionalNonEmpty,
  STRIPE_PRICE_PLUS: optionalNonEmpty,
  STRIPE_PRICE_BUSINESS: optionalNonEmpty,
  STRIPE_PRICE_ACCOUNTANT: optionalNonEmpty,
});

type Env = z.infer<typeof schema>;

// Detect Next.js build phase. Next sets NEXT_PHASE=phase-production-build
// while running `next build` page-data collection. Route-handler modules
// get imported during that pass even though they never serve a real
// request — throwing inside env() at that moment kills the deploy even
// when production env vars ARE configured to be injected at runtime.
//
// Behaviour:
//   - build phase: warn-and-stub. Returns a pass-through view of
//     process.env. Routes that hit env() get whatever string the build
//     environment exposed (often undefined). They MUST guard their own
//     module-level reads for build-time safety, OR rely on the fact that
//     handler bodies only run at request time when real env values exist.
//   - runtime production: strict — throw if validation fails. The
//     deployed app refuses to serve requests with missing env.
//   - dev / test: warn + pass-through (existing behaviour).
const isNextBuildPhase = process.env["NEXT_PHASE"] === "phase-production-build";

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    if (isProduction && !isNextBuildPhase) {
      throw new Error(
        `Invalid environment variables: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
      );
    }
    // Dev / test / build phase: surface the issue but don't crash so
    // that partial setups (e.g., no Sentry yet) and prerender passes
    // keep working. Runtime in production is still strict above.
    console.warn(
      "Environment variable validation failed:",
      parsed.error.flatten().fieldErrors,
    );
  }

  cached = (parsed.success ? parsed.data : (process.env as unknown as Env));
  return cached;
}
