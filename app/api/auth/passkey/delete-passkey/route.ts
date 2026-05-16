// Step-up shim for `POST /api/auth/passkey/delete-passkey`.
//
// Same model as the two-factor/disable shim — the Better Auth
// catch-all otherwise allows passkey deletion on any valid session
// cookie. Removing every passkey kills a strong factor without
// re-auth proof, so we gate the call behind the registry's
// `passkey.delete_all` op.

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
      op: "passkey.delete_all",
      payloadHash: computePayloadHash({
        userId: me.appUserId,
        action: "passkey.delete_all",
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
