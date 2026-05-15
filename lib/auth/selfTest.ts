import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { dbService } from "@/db/client";
import { getKek } from "@/lib/security/kek";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  type AesGcmAad,
} from "@/lib/security/encryption";

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
