// Step-up shim for `POST /api/auth/two-factor/disable`.
//
// The Better Auth catch-all at `/api/auth/[...all]` ordinarily handles
// this path. Without an intercept, a stolen valid session cookie can
// disable MFA without re-authentication — defeating the whole point
// of the second factor. This file takes precedence over the
// catch-all (Next routing prefers specific over wildcard) and:
//
//   1. Resolves the current user.
//   2. Runs `requireFreshSession({op:"mfa.disable", ...})` so the
//      caller must have a fresh step-up grant within the registry's
//      `maxAge`. The payload hash binds the disable to this user.
//   3. On freshness failure, returns 401 with `{op, payloadHash}` so
//      the client can POST `/api/auth/step-up` then retry.
//   4. On success, forwards to Better Auth's own handler — keeping
//      the canonical disable logic (DB row update, cookie hygiene)
//      in one place rather than re-implementing it.

import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/better";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import {
  computePayloadHash,
  requireFreshSession,
  StepUpRequired,
} from "@/lib/auth/stepUp";

export const dynamic = "force-dynamic";

const fallback = toNextJsHandler(auth);

export async function POST(req: Request): Promise<Response> {
  let me;
  try {
    me = await requireCurrentUser();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await requireFreshSession({
      op: "mfa.disable",
      payloadHash: computePayloadHash({
        userId: me.appUserId,
        action: "mfa.disable",
      }),
    });
  } catch (err) {
    if (err instanceof StepUpRequired) {
      return Response.json(
        { error: "step_up_required", op: err.op, payloadHash: err.payloadHash },
        { status: 401 },
      );
    }
    throw err;
  }

  return fallback.POST(req);
}
