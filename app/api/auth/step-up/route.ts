import { headers as nextHeaders } from "next/headers";
import { auth } from "@/lib/auth/better";
import { currentUser } from "@/lib/auth/serverSession";
import {
  STEP_UP_OPS,
  type StepUpOp,
  grantStepUp,
  denyStepUp,
} from "@/lib/auth/stepUp";

// POST /api/auth/step-up
//
// Body: { op: StepUpOp, payloadHash: string, factor: 'password'|'totp'|'passkey', credential: string }
//
// Verifies the chosen factor for the currently signed-in user. On
// success, writes a `step_up_grant` auth_events row keyed to (op,
// payloadHash) so any subsequent server action calling
// requireFreshSession({op, payloadHash}) within 5 min passes.
//
// Security council C-2 binding: grants are scoped to (op, payloadHash)
// so a grant for invoice-A cannot release invoice-B. The payloadHash
// MUST be computed by the calling action via
// lib/auth/stepUp.computePayloadHash() over the action's invariant
// fields.

export const dynamic = "force-dynamic";

type StepUpBody = {
  op?: string;
  payloadHash?: string;
  factor?: string;
  credential?: string;
};

function isStepUpOp(v: string): v is StepUpOp {
  return (STEP_UP_OPS as readonly string[]).includes(v);
}

export async function POST(request: Request): Promise<Response> {
  const me = await currentUser();
  if (!me) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: StepUpBody;
  try {
    body = (await request.json()) as StepUpBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const op = body.op;
  const payloadHash = body.payloadHash;
  const factor = body.factor;
  const credential = body.credential;

  if (typeof op !== "string" || !isStepUpOp(op)) {
    return Response.json({ error: "unknown_op" }, { status: 400 });
  }
  if (typeof payloadHash !== "string" || !/^[a-f0-9]{64}$/i.test(payloadHash)) {
    return Response.json({ error: "invalid_payload_hash" }, { status: 400 });
  }
  if (
    factor !== "password" &&
    factor !== "totp" &&
    factor !== "passkey"
  ) {
    return Response.json({ error: "invalid_factor" }, { status: 400 });
  }
  if (typeof credential !== "string" || credential.length === 0) {
    return Response.json({ error: "credential_required" }, { status: 400 });
  }

  const hs = await nextHeaders();

  try {
    if (factor === "password") {
      // Re-verify the password via Better Auth sign-in. The returned
      // token is discarded — we only need to confirm the password is
      // correct. signInEmail throws on bad credentials.
      await auth.api.signInEmail({
        body: { email: me.email, password: credential, rememberMe: false },
        headers: hs,
      });
    } else if (factor === "totp") {
      // Better Auth two-factor plugin exposes verifyTOTP. The plugin
      // throws (or returns an error response) on bad code.
      const api = auth.api as unknown as Record<string, unknown>;
      const verifyTOTP = api["verifyTOTP"];
      if (typeof verifyTOTP !== "function") {
        return Response.json(
          { error: "totp_not_configured" },
          { status: 500 },
        );
      }
      await (verifyTOTP as (a: {
        body: { code: string };
        headers: Headers;
      }) => Promise<unknown>)({
        body: { code: credential },
        headers: hs,
      });
    } else {
      // factor === "passkey" — Better Auth's passkey plugin exposes a
      // verifyAuthentication endpoint. Since the WebAuthn assertion
      // ceremony is multi-round, the client should drive it through the
      // passkey plugin's normal sign-in flow with the resulting
      // assertion payload threaded back into this endpoint. For now,
      // treat the credential as a base64-encoded WebAuthn assertion
      // JSON envelope.
      const api = auth.api as unknown as Record<string, unknown>;
      const verifyPasskey = api["verifyAuthentication"] ?? api["verifyPasskeyAuthentication"];
      if (typeof verifyPasskey !== "function") {
        return Response.json(
          { error: "passkey_not_configured" },
          { status: 500 },
        );
      }
      let assertion: unknown;
      try {
        assertion = JSON.parse(Buffer.from(credential, "base64").toString("utf8"));
      } catch {
        return Response.json(
          { error: "invalid_passkey_assertion" },
          { status: 400 },
        );
      }
      await (verifyPasskey as (a: {
        body: { response: unknown };
        headers: Headers;
      }) => Promise<unknown>)({
        body: { response: assertion },
        headers: hs,
      });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "verification_failed";
    await denyStepUp({ op, payloadHash, factor, reason: reason.slice(0, 200) });
    return Response.json({ error: "factor_verification_failed" }, { status: 401 });
  }

  await grantStepUp({ op, payloadHash, factor });

  // 5-min TTL — must match STEP_UP_DEFAULT_MAX_AGE_SEC in stepUp.ts.
  const expiresAt = new Date(Date.now() + 300 * 1000).toISOString();
  return Response.json({ ok: true, expiresAt });
}
