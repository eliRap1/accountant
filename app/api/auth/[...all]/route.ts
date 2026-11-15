import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/better";

// Mount Better Auth's handler at /api/auth/* — covers sign-in, sign-up,
// verify-email, 2fa, passkey, OTP, and admin flows in one route. Better
// Auth's internal router parses the wildcard segment.
export const { GET, POST } = toNextJsHandler(auth);

// Required because Better Auth touches cookies + headers per-request; with
// static optimization on it would 500 on first sign-in.
export const dynamic = "force-dynamic";
