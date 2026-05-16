import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { dbService } from "@/db/client";
import { env } from "@/lib/env";
import { getKek } from "@/lib/security/kek";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  type AesGcmAad,
} from "@/lib/security/encryption";

// SHA-256 hashes of the secrets exposed in chat transcript on
// 2026-05-16 (handoff.md § SECURITY). Production deploys MUST refuse
// to boot if any current env value matches one of these — see
// docs/runbooks/vercel-env-setup.md for rotation steps.
//
// Hashes computed with `node -e "crypto.createHash('sha256').update(s).digest('hex')"`
// over the exact base64 string that lived in the chat transcript.
const COMPROMISED_BETTER_AUTH_SECRET_HASH =
  "dd1450b4de2ab18c94798b831aaed0231d2a6f61fdf3617262370f0834cbb2a9";
const COMPROMISED_DATA_ENCRYPTION_KEY_HASH =
  "b3d1b41dc7ea60bf3594b20d5abec8bb9d71d9655bbe261cba0fec4c04e1a152";
const COMPROMISED_TURNSTILE_SECRET_HASH =
  "7f31b345f2a623f8af79e0419e1c2a2c652c53edceaf52b337ddf3ccce0ff9e7";

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

// Boot-time integrity check. Runs once via instrumentation.ts.register().
//
// Goal: refuse to start the server when any link in the auth/crypto chain
// is misconfigured, so we never serve a request that would otherwise
// succeed-then-leak (e.g. AES-GCM silently treating a wrong-length key as
// padding, or scrypt unavailable on a stripped-down container image).
export async function runStartupSelfTest(): Promise<void> {
  const probeAad: AesGcmAad = {
    table: "_probe",
    column: "_probe",
    rowId: "_probe",
  };

  // 0. Production-only deploy gates (council C-4 + C-5).
  //
  // 0a. Refuse to boot if any of the three secrets the chat transcript
  //     exposed on 2026-05-16 are still live. The chat-pasted secrets
  //     are documented in handoff.md § SECURITY. Rotation steps in
  //     docs/runbooks/vercel-env-setup.md.
  //
  // 0b. Refuse to boot if Turnstile is unset in production —
  //     sign-up captcha is the only effective rate-limit gate.
  //
  // Both checks skip in dev/test so contributors can use the seed
  //     values without ceremony.
  const e = env();
  if (e.NODE_ENV === "production") {
    const betterAuthSecretHash = sha256Hex(e.BETTER_AUTH_SECRET);
    if (betterAuthSecretHash === COMPROMISED_BETTER_AUTH_SECRET_HASH) {
      throw new Error(
        "Secret BETTER_AUTH_SECRET matches the known-compromised value from session 2026-05-16. Rotate before deploying. See docs/runbooks/vercel-env-setup.md.",
      );
    }
    const kekHash = sha256Hex(e.DATA_ENCRYPTION_KEY);
    if (kekHash === COMPROMISED_DATA_ENCRYPTION_KEY_HASH) {
      throw new Error(
        "Secret DATA_ENCRYPTION_KEY matches the known-compromised value from session 2026-05-16. Rotate before deploying. See docs/runbooks/vercel-env-setup.md.",
      );
    }
    const turnstileSecret = e.TURNSTILE_SECRET_KEY;
    if (turnstileSecret) {
      const turnstileHash = sha256Hex(turnstileSecret);
      if (turnstileHash === COMPROMISED_TURNSTILE_SECRET_HASH) {
        throw new Error(
          "Secret TURNSTILE_SECRET_KEY matches the known-compromised value from session 2026-05-16. Rotate before deploying. See docs/runbooks/vercel-env-setup.md.",
        );
      }
    }

    // 0c. Turnstile must be configured in production. The captcha
    //     plugin in lib/auth/better.tsx is gated on the secret being
    //     present; if the env is empty in prod we'd ship sign-up
    //     unprotected.
    if (!e.TURNSTILE_SECRET_KEY || !e.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      throw new Error(
        "Turnstile is required in production. Set TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY.",
      );
    }
  }

  // 1. Node crypto.scrypt round-trip. Better Auth 1.6.x uses scrypt for
  //    password hashing under the hood; if Node's scrypt fails on this
  //    runtime, no sign-up can ever succeed.
  const password = "selftest-canary-" + Date.now();
  const salt = crypto.randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, 32, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
  if (derived.length !== 32) {
    throw new Error("selfTest: scrypt produced wrong-length key");
  }

  // 2. KEK shape + AES-256-GCM round-trip. Forces a hard error early if
  //    DATA_ENCRYPTION_KEY is missing, truncated, or non-base64.
  const kek = getKek();
  const probePlaintext = "selftest-probe-" + crypto.randomUUID();
  const { iv, authTag, ciphertext } = aesGcmEncrypt({
    key: kek,
    plaintext: probePlaintext,
    aad: probeAad,
  });
  const recovered = aesGcmDecrypt({
    key: kek,
    iv,
    authTag,
    ciphertext,
    aad: probeAad,
  });
  if (recovered !== probePlaintext) {
    throw new Error("selfTest: AES-GCM round-trip mismatch");
  }

  // 2b. AAD tamper check — flipping any field of the AAD MUST fail decrypt.
  let aadTamperDetected = false;
  try {
    aesGcmDecrypt({
      key: kek,
      iv,
      authTag,
      ciphertext,
      aad: { ...probeAad, column: "wrong" },
    });
  } catch {
    aadTamperDetected = true;
  }
  if (!aadTamperDetected) {
    throw new Error(
      "selfTest: AES-GCM accepted a wrong AAD — auth tag binding broken",
    );
  }

  // 3. DB liveness. Uses the service-role pool so RLS configuration cannot
  //    mask a genuine connectivity failure as zero-row reads.
  const rows = await dbService.execute(sql`SELECT 1 AS ok`);
  // postgres-js returns an array of rows; verify the shape we expect.
  if (!Array.isArray(rows) || rows[0]?.["ok"] !== 1) {
    throw new Error("selfTest: DB liveness check returned unexpected shape");
  }
}
