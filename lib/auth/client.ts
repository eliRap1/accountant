"use client";

import { createAuthClient } from "better-auth/react";
import {
  twoFactorClient,
  emailOTPClient,
  adminClient,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

// Mirror the plugin list in lib/auth/better.ts so the typed `authClient`
// surface (signIn, signUp, twoFactor.*, passkey.*, …) matches the server.
// Plugins MUST be added in client + server in lockstep.
export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? process.env["BETTER_AUTH_URL"]
      : window.location.origin,
  plugins: [
    twoFactorClient({
      // Better Auth signals "needs 2FA" via this callback after a
      // successful password match. A hard navigation is the right
      // choice — Next's client router would otherwise reuse the
      // sign-in page tree and the new 2FA page would mount without
      // remounting the session refresh atoms.
      onTwoFactorRedirect: () => {
        if (typeof window !== "undefined") {
          window.location.href = "/2fa/verify";
        }
      },
    }),
    passkeyClient(),
    emailOTPClient(),
    adminClient(),
  ],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  // Better Auth 1.6.x renamed forgetPassword → requestPasswordReset. The
  // old name is shadowed by the emailOTP plugin in TS (becomes a
  // namespace) even though the runtime function still exists.
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
  twoFactor,
  passkey,
  emailOtp,
} = authClient;
