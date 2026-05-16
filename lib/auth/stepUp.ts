import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";

// We dynamic-import currentUser inside the functions that need it. The
// reason is layering: lib/auth/serverSession.ts → currentUser.ts →
// lib/auth/better.tsx → lib/email/client.ts → "server-only". Static-
// importing it here would force the server-only barrier into any test
// runner that touches stepUp, which the C-3 closed-period integration
// test does. Dynamic import lets vi.doMock("@/lib/auth/serverSession")
// supply a test double without dragging in the email/auth chain.
async function getCurrentUser(): Promise<{
  authUserId: string;
  appUserId: string;
} | null> {
  const mod = await import("@/lib/auth/serverSession");
  const u = await mod.currentUser();
  if (!u) return null;
  return { authUserId: u.authUserId, appUserId: u.appUserId };
}

// Step-up auth (Plan v4 Risk #10 / council C-2).
//
// Pattern: a sensitive op (e.g. invoice ≥ ₪10k, account delete, MFA
// disable) requires a "fresh" proof of presence within the last 5 min.
// The grant is bound to BOTH:
//   - the operation symbol (`op`), and
//   - a SHA-256 hash of the action's invariant payload (`payloadHash`)
// so a step-up grant for op X with payload P cannot be replayed for
// op X with payload Q (e.g. issuing invoice A cannot release issuance
// of invoice B).
//
// Storage: auth_events rows of type `step_up_grant`. Metadata =
// {op, payloadHash, expires_at}. The default TTL is 300 s (5 min).
//
// Verification factor (TOTP / passkey / password) is captured in the
// metadata `factor` field but freshness is computed off `created_at`
// alone — once the grant is written, any factor counts as a proof.

export const STEP_UP_DEFAULT_MAX_AGE_SEC = 300;

// Registry of all sensitive operations recognised by the gate. Adding a
// new op here is mandatory before any call site uses it — typos in op
// strings would otherwise silently pass.
export const STEP_UP_OPS = [
  // Invoicing
  "invoice.issue_high_value", // ≥ ₪10k, ₪5k from 2026-06-01
  // Tax filings (export = irreversible-from-our-side regulator surface)
  "filing.export_pcn874",
  "filing.export_form6111",
  "filing.export_form102",
  "filing.export_form1301",
  "filing.export_form1214",
  // Business profile mutations that change tax-regime behaviour
  "business.update_vat_status",
  "business.update_payout_bank",
  "business.update_default_currency",
  // Account lifecycle
  "account.delete",
  // PII reveal surfaces
  "pii.decrypt_tax_id",
  "pii.decrypt_national_id",
  "pii.decrypt_dob",
  "pii.decrypt_owner_pii",
  // Credentials reveal
  "processor.view_credentials",
  // Auth-factor mutations
  "mfa.reset",
  "mfa.disable",
  "passkey.delete_all",
  "recovery.redeem_code",
  // Accountant engagement
  "engagement.claim",
  "engagement.elevate_role",
  // Ledger immutability override (Plan v4 § 5.2)
  "ledger.post_to_closed_period",
  // Audit Package Builder (CPA council § 8 — Q3 binding decision).
  // Build is the moment that touches decrypted PII across multiple
  // tables; download merely streams an opaque ciphertext blob. Both
  // are step-up gated so the audit-trail surfaces every access on
  // the `audit_packages` artifact.
  "audit.build_package",
  "audit.download_package",
] as const;

export type StepUpOp = (typeof STEP_UP_OPS)[number];

export class StepUpRequired extends Error {
  readonly op: StepUpOp;
  readonly payloadHash: string;
  constructor(op: StepUpOp, payloadHash: string) {
    super(`step-up required for op=${op}`);
    this.name = "StepUpRequired";
    this.op = op;
    this.payloadHash = payloadHash;
  }
}

// Canonical-JSON SHA-256. We sort keys at every level so that
// `{a:1, b:2}` and `{b:2, a:1}` hash identically — important because the
// caller and the verifier may serialise differently. Numbers / nulls /
// nested objects are stringified per JSON's standard rules.
export function computePayloadHash(payload: unknown): string {
  const canonical = canonicalise(payload);
  const json = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(json, "utf8").digest("hex");
}

function canonicalise(v: unknown): unknown {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(canonicalise);
  if (typeof v !== "object") return v;
  // Plain object: sort keys, recurse.
  const entries = Object.entries(v as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const out: Record<string, unknown> = {};
  for (const [k, val] of entries) out[k] = canonicalise(val);
  return out;
}

/**
 * Throw if no step-up grant matching (userId, op, payloadHash) exists
 * within `maxAgeSec` seconds. The caller is expected to surface the
 * thrown StepUpRequired to the client, which then triggers a step-up
 * modal that POSTs to /api/auth/step-up and retries the action.
 */
export async function requireFreshSession(args: {
  op: StepUpOp;
  payloadHash: string;
  maxAgeSec?: number;
}): Promise<void> {
  const maxAge = args.maxAgeSec ?? STEP_UP_DEFAULT_MAX_AGE_SEC;
  const me = await getCurrentUser();
  if (!me) throw new StepUpRequired(args.op, args.payloadHash);

  const grant = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id, created_at, metadata_jsonb
            FROM auth_events
           WHERE user_id = ${me.appUserId}::uuid
             AND event_type = 'step_up_grant'::auth_event_type
             AND metadata_jsonb->>'op' = ${args.op}
             AND metadata_jsonb->>'payloadHash' = ${args.payloadHash}
             AND created_at >= now() - (${maxAge}::int * interval '1 second')
           ORDER BY created_at DESC
           LIMIT 1`,
    )) as unknown as Array<{ id: string; created_at: Date }>;
    return rows[0] ?? null;
  });

  if (!grant) throw new StepUpRequired(args.op, args.payloadHash);
}

/**
 * Write a fresh `step_up_grant` row for the current user. Called from
 * the /api/auth/step-up endpoint AFTER a factor (password / TOTP /
 * passkey) is verified. Future requireFreshSession() calls matching
 * (op, payloadHash) within the TTL will pass.
 */
export async function grantStepUp(args: {
  op: StepUpOp;
  payloadHash: string;
  factor: "password" | "totp" | "passkey";
}): Promise<void> {
  const me = await getCurrentUser();
  if (!me) throw new Error("grantStepUp: no active session");
  const metadata = JSON.stringify({
    op: args.op,
    payloadHash: args.payloadHash,
    factor: args.factor,
  });
  await withServiceRole(async (tx) => {
    await tx.execute(
      sql`INSERT INTO auth_events (user_id, auth_user_id, event_type, metadata_jsonb)
          VALUES (
            ${me.appUserId}::uuid,
            ${me.authUserId},
            'step_up_grant'::auth_event_type,
            ${metadata}::jsonb
          )`,
    );
  });
}

/**
 * Write a step_up_deny row — called when a factor verification fails.
 * Surfaces brute-force / cookie-stuffing attempts in the audit log.
 */
export async function denyStepUp(args: {
  op: StepUpOp;
  payloadHash: string;
  factor: "password" | "totp" | "passkey";
  reason: string;
}): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return; // No user => nothing to attribute the denial to.
  const metadata = JSON.stringify({
    op: args.op,
    payloadHash: args.payloadHash,
    factor: args.factor,
    reason: args.reason,
  });
  await withServiceRole(async (tx) => {
    await tx.execute(
      sql`INSERT INTO auth_events (user_id, auth_user_id, event_type, metadata_jsonb)
          VALUES (
            ${me.appUserId}::uuid,
            ${me.authUserId},
            'step_up_deny'::auth_event_type,
            ${metadata}::jsonb
          )`,
    );
  });
}
