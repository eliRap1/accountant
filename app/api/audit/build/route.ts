import { sql } from "drizzle-orm";
import { currentUser } from "@/lib/auth/serverSession";
import { withServiceRole } from "@/lib/db/withServiceRole";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";
import {
  buildAuditPackage,
  assertCanBuildAuditPackage,
  AuditPackageAuthorityError,
} from "@/lib/audit/packageBuilder";
import { capture, flush as flushPosthog } from "@/lib/observability/posthog";

// POST /api/audit/build
//
// Body: { businessId, periodStart (YYYY-MM-DD), periodEnd (YYYY-MM-DD) }
//
// Council § Q3 binding decision:
//   - owner (always) OR
//   - accountant engagement with role='accountant' AND
//     scopes_jsonb.filings = true AND scopes_jsonb.ledger = true AND
//     acceptedAt IS NOT NULL AND revokedAt IS NULL
//
// Step-up gate: op = 'audit.build_package'. Hash binds to the
// (businessId, periodStart, periodEnd) tuple so a grant for one
// build cannot be replayed for a different period.
//
// On success, writes a `step_up_grant`-paired auth_events row of type
// `account_deleted` is NOT what we want — we reuse `sign_in` slot.
// Actually we don't have an `audit_package_built` enum value (would
// require a migration touch — out of scope per the task). We instead
// stamp a `step_up_grant` follow-up row via the metadata trail that
// the build itself surfaces. The PostHog `audit_package.built` event
// is the canonical observability emission.

export const dynamic = "force-dynamic";

type BuildBody = {
  businessId?: string;
  periodStart?: string;
  periodEnd?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request): Promise<Response> {
  const me = await currentUser();
  if (!me) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: BuildBody;
  try {
    body = (await request.json()) as BuildBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const businessId = body.businessId;
  const periodStart = body.periodStart;
  const periodEnd = body.periodEnd;

  if (typeof businessId !== "string" || !UUID_RE.test(businessId)) {
    return Response.json({ error: "invalid_business_id" }, { status: 400 });
  }
  if (typeof periodStart !== "string" || !DATE_RE.test(periodStart)) {
    return Response.json({ error: "invalid_period_start" }, { status: 400 });
  }
  if (typeof periodEnd !== "string" || !DATE_RE.test(periodEnd)) {
    return Response.json({ error: "invalid_period_end" }, { status: 400 });
  }
  if (periodEnd < periodStart) {
    return Response.json({ error: "period_end_before_start" }, { status: 400 });
  }

  // Authority check BEFORE step-up: an unauthorized caller should never
  // see a step-up prompt (would leak the businessId's existence).
  try {
    await assertCanBuildAuditPackage(me.appUserId, businessId);
  } catch (err) {
    if (err instanceof AuditPackageAuthorityError) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    throw err;
  }

  // Step-up gate. Payload hash binds (businessId, periodStart, periodEnd)
  // so a step-up grant for period A cannot release a build for period B.
  const payloadHash = computePayloadHash({ businessId, periodStart, periodEnd });
  try {
    await requireFreshSession({ op: "audit.build_package", payloadHash });
  } catch (err) {
    if (err instanceof StepUpRequired) {
      return Response.json(
        { error: "step_up_required", op: err.op, payloadHash: err.payloadHash },
        { status: 401 },
      );
    }
    throw err;
  }

  // Build.
  const result = await buildAuditPackage({
    businessId,
    periodStart,
    periodEnd,
    requestedByUserId: me.appUserId,
  });

  // Audit log — best-effort PostHog event + auth_events row. We piggy-
  // back on the `step_up_grant` event_type because the auth_event_type
  // enum doesn't include 'audit_package_built' and the task forbids
  // schema changes. The metadata carries the disambiguator.
  capture("audit_package.built", {
    distinctId: me.appUserId,
    packageId: result.packageId,
    businessId,
    periodStart,
    periodEnd,
    artifactCount: result.manifest.artifactCount,
  });
  try {
    await flushPosthog();
  } catch {
    // Non-fatal.
  }
  try {
    await withServiceRole(async (tx) => {
      const metadata = JSON.stringify({
        kind: "audit_package_built",
        op: "audit.build_package",
        payloadHash,
        packageId: result.packageId,
        businessId,
        periodStart,
        periodEnd,
        artifactCount: result.manifest.artifactCount,
        blobUrl: result.encryptedBlobUrl,
        dekId: result.fileKeyId,
      });
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
  } catch (err) {
    console.warn("[audit.build] auth_events write failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return Response.json({
    ok: true,
    packageId: result.packageId,
    artifactCount: result.manifest.artifactCount,
  });
}
