import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor, emailOTP, admin, captcha } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { db } from "@/db/client";
import { env } from "@/lib/env";

const turnstileSecret = env().TURNSTILE_SECRET_KEY;

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: env().BETTER_AUTH_SECRET,
  baseURL: env().BETTER_AUTH_URL,

  // Email + password is the default sign-in path. OTP / passkey are alternatives.
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },

  // Session cookie hardening — see plan v3 Risk #1 + Risk #10.
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh after 1 day
    cookieCache: { enabled: true, maxAge: 5 * 60 }, // 5-min cookie cache for hot paths
  },

  advanced: {
    cookiePrefix: "accountant",
    useSecureCookies: env().NODE_ENV === "production",
    defaultCookieAttributes: {
      sameSite: "lax",
      httpOnly: true,
    },
  },

  // OAuth providers: deferred until we wire callbacks per locale.
  socialProviders: {},

  // Email delivery via Resend. The actual sender is wired in lib/email/client.ts
  // once it lands in Phase A.7 — until then these hooks log instead of sending.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      // TODO(A.7): swap for lib/email/client.ts sendVerification(user, url, locale)
      console.info("[auth] sendVerificationEmail", { to: user.email, url });
    },
  },

  plugins: [
    // TOTP authenticator + recovery codes. Step-up auth (Risk #10) consults this.
    twoFactor({
      issuer: "AccounTech",
      otpOptions: { period: 30 },
    }),
    // WebAuthn / passkeys for passwordless sign-in.
    passkey({
      rpID: env().NODE_ENV === "production"
        ? new URL(env().BETTER_AUTH_URL).hostname
        : "localhost",
      rpName: "AccounTech",
      origin: env().BETTER_AUTH_URL,
    }),
    // One-time email codes — used by recovery and as a passwordless option.
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      sendVerificationOTP: async ({ email, otp }) => {
        // TODO(A.7): swap for lib/email/client.ts sendOtp(email, otp, locale)
        console.info("[auth] sendVerificationOTP", { to: email, otp });
      },
    }),
    // Admin tooling for support flows. Reads gated by service role.
    admin(),
    // Cloudflare Turnstile gate on sign-up + sensitive flows.
    ...(turnstileSecret
      ? [captcha({ provider: "cloudflare-turnstile", secretKey: turnstileSecret })]
      : []),
  ],

  // Custom user table is created by our app schema in db/schema/users.ts. Better
  // Auth's own `user` table coexists; `databaseHooks.user.create.after` mirrors a
  // row into our app `users` table (see lib/auth/ensureUser.ts).
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const { ensureAppUser } = await import("@/lib/auth/ensureUser");
          await ensureAppUser(user);
        },
      },
    },
  },
});

export type Auth = typeof auth;
