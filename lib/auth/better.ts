import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor, emailOTP, admin, captcha } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
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

  // Session cookie hardening — see plan v4 Risk #1 + Risk #10.
  // Council Security: cookieCache must be DISABLED for a finance app. A 5-min
  // signed-cookie cache lets a banned/MFA-reset user keep authing for up to
  // 5min without DB lookup. Step-up freshness becomes meaningless.
  // Absolute lifetime + frequent refresh, no refresh-token model.
  session: {
    expiresIn: 60 * 60 * 24 * 14, // 14 days absolute
    updateAge: 60 * 60 * 4, // refresh after 4 hours
    cookieCache: { enabled: false, maxAge: 0 },
  },

  // Cookies: we do NOT advertise the __Host- prefix here. Better Auth derives
  // the cookie name as `<cookiePrefix>.session_token`. To use the real
  // __Host- prefix the cookie must be Path=/ + Secure + no Domain, AND the
  // browser parses the prefix from the name itself. Easier path: a namespaced
  // prefix + Secure + HttpOnly + SameSite=Lax with no Domain attribute. The
  // attacker-resistance gap vs __Host- is small.
  advanced: {
    cookiePrefix: "accountant",
    useSecureCookies: env().NODE_ENV === "production",
    defaultCookieAttributes: {
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    },
  },

  // OAuth providers: deferred until we wire callbacks per locale.
  socialProviders: {},

  // Email delivery via Resend. The actual sender is wired in lib/email/client.ts
  // once it lands in Phase A.7 — until then these hooks log instead of sending.
  emailVerification: {
    sendOnSignUp: true,
    // Council Security: with requireEmailVerification + autoSignIn:false,
    // a user who clicks the verify link otherwise lands on a "verified"
    // page with no session, must sign in again, then enroll TOTP — three
    // hops. Verification IS the proof for a low-trust dev flow.
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // TODO(A.7): swap for lib/email/client.ts sendVerification(user, url, locale).
      // Note: do NOT log the verification URL once real email lands —
      // it's a single-use credential. Log a hash for breadcrumb only.
      console.info("[auth] sendVerificationEmail", { to: user.email });
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
      // Council Security: 600s OTP window is too wide for 1M code space.
      // Cut to 120s; brute-force window narrows 5x with no UX hit (Resend
      // typically delivers in under 5 seconds).
      expiresIn: 120,
      sendVerificationOTP: async ({ email }) => {
        // TODO(A.7): swap for lib/email/client.ts sendOtp(email, otp, locale).
        // Council Security: never log the OTP — single-use credential in
        // a transcript-shareable channel. Log destination only.
        console.info("[auth] sendVerificationOTP", { to: email });
      },
    }),
    // Admin tooling for support flows. Reads gated by service role.
    admin(),
    // Cloudflare Turnstile gate on sign-up + sensitive flows.
    ...(turnstileSecret
      ? [captcha({ provider: "cloudflare-turnstile", secretKey: turnstileSecret })]
      : []),
    // MUST be last — wraps response cookies into the Next.js response
    // headers that route handlers + middleware return.
    nextCookies(),
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
