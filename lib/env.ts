import { z } from "zod";

const isProduction = process.env["NODE_ENV"] === "production";

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
  RESEND_API_KEY: z.string().min(1).optional(),

  // CAPTCHA (Cloudflare Turnstile)
  TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),

  // AI Gateway / OpenAI
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().default("openai/gpt-5.4-mini"),
  AI_ESCALATION_MODEL: z.string().default("openai/gpt-5.4"),

  // Observability
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().default("https://eu.i.posthog.com"),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    if (isProduction) {
      throw new Error(
        `Invalid environment variables: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
      );
    }
    // In dev/test, surface the issue but don't crash so that
    // partial setups (e.g., no Sentry yet) keep working.
    console.warn(
      "Environment variable validation failed:",
      parsed.error.flatten().fieldErrors,
    );
  }

  cached = (parsed.success ? parsed.data : (process.env as unknown as Env));
  return cached;
}
