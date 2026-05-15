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
    twoFactorClient(),
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
  forgetPassword,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
  twoFactor,
  passkey,
  emailOtp,
} = authClient;
