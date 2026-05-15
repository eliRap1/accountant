import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor, emailOTP, admin, captcha } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { passkey } from "@better-auth/passkey";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/client";
import { pickTemplate, fillText, type EmailKey } from "@/lib/email/dispatch";
import {
  lookupLocaleForUser,
  lookupLocaleForEmail,
} from "@/lib/email/lookupLocale";

const turnstileSecret = env().TURNSTILE_SECRET_KEY;

// Map an emailOTP `type` to a template key. Better Auth's emailOTP plugin
// reuses one send hook for sign-in / email-verification / forget-password /
// change-email. We pick the closest CPA-safe template per type:
//   - email-verification → reuses the signup verification template
//   - forget-password    → password reset
//   - sign-in            → reuses verification (passwordless sign-in)
//   - change-email       → reuses verification (proving new mailbox)
function templateForOtpType(
  type: "sign-in" | "email-verification" | "forget-password" | "change-email",
): EmailKey {
  if (type === "forget-password") return "resetPassword";
  return "verifyEmail";
}

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

  // Email delivery via Resend. Sender lives in lib/email/client.ts; the
  // locale dispatch + template selection lives in lib/email/dispatch.ts.
  emailVerification: {
    sendOnSignUp: true,
    // Council Security: with requireEmailVerification + autoSignIn:false,
    // a user who clicks the verify link otherwise lands on a "verified"
    // page with no session, must sign in again, then enroll TOTP — three
    // hops. Verification IS the proof for a low-trust dev flow.
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Council Security: do NOT log the verification URL — it's a
      // single-use credential. The dispatch resolver picks the locale's
      // template; sendEmail handles skip-mode when RESEND_API_KEY is unset.
      const locale = await lookupLocaleForUser(user.id);
      const tpl = pickTemplate(locale, "verifyEmail");
      const result = await sendEmail({
        to: user.email,
        subject: tpl.subject,
        kind: "verify",
        react: <tpl.Component user={user} url={url} locale={locale} />,
        text: fillText(tpl.text, { url }),
        tags: [{ name: "type", value: "verifyEmail" }],
      });
      if ("error" in result) {
        console.warn("[auth] sendVerificationEmail failed", {
          to: user.email,
          error: result.error.message,
        });
      }
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
      sendVerificationOTP: async ({ email, otp, type }) => {
        // Council Security: never log the OTP — single-use credential in
        // a transcript-shareable channel. Log destination only.
        const locale = await lookupLocaleForEmail(email);
        const key = templateForOtpType(type);
        const tpl = pickTemplate(locale, key);
        // OTP appears in body via the `url` slot — for OTP flows it's a
        // verbatim code, not a hyperlink. Wrap in a marker so the
        // template's CTA still renders something meaningful.
        const otpDisplay = `OTP: ${otp}`;
        const result = await sendEmail({
          to: email,
          subject: `${tpl.subject} (${otp})`,
          kind: type === "forget-password" ? "security" : "verify",
          react: (
            <tpl.Component
              user={{ email }}
              url={otpDisplay}
              locale={locale}
            />
          ),
          text: fillText(tpl.text, { url: otpDisplay }),
          tags: [
            { name: "type", value: key },
            { name: "otp_flow", value: type },
          ],
        });
        if ("error" in result) {
          console.warn("[auth] sendVerificationOTP failed", {
            to: email,
            type,
            error: result.error.message,
          });
        }
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
