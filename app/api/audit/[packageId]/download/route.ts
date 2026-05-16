import { sql } from "drizzle-orm";
import { currentUser } from "@/lib/auth/serverSession";
import { withServiceRole } from "@/lib/db/withServiceRole";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";
import {
  assertCanBuildAuditPackage,
  AuditPackageAuthorityError,
  AuditPackageDekRetiredError,
  AuditPackageNotFoundError,
  decryptAuditPackage,
} from "@/lib/audit/packageBuilder";

// GET /api/audit/[packageId]/download
//
// Looks up the audit_packages row, runs the same authority gate as
// /api/audit/build (owner OR engaged-accountant-with-filings-AND-ledger),
// requires a fresh step-up grant for op='audit.download_package'
// bound to the packageId, then unwraps the per-package DEK, fetches
// the encrypted blob, decrypts, and streams the ZIP as
// application/zip.
//
// 401 paths:
//   - no session → 401 unauthorized
//   - step-up missing → 401 step_up_required + op/payloadHash echoed
//   - DEK retired (crypto-erasure) → 401 dek_retired
//
// 403 paths:
//   - authority denied → 403 forbidden
//
// 404 paths:
//   - packageId not found in audit_packages → 404 not_found
//   - audit_packages row exists but file_blob_url / file_key_id is null
//     (build never finished) → 404 not_ready

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PkgRow = {
  id: string;
  business_id: string;
  file_blob_url: string | null;
  file_key_id: string | null;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ packageId: string }> },
): Promise<Response> {
  const me = await currentUser();
  if (!me) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { packageId } = await ctx.params;
  if (!UUID_RE.test(packageId)) {
    return Response.json({ error: "invalid_package_id" }, { status: 400 });
  }

  // Service-role lookup of the audit_packages row to recover the
  // business_id (for the authority gate) + blob URL + DEK id. The
  // owner-only RLS policy on audit_packages would block an engaged
  // accountant's SELECT through `withUser`; the council Q3 path
  // requires us to bypass with the service role and re-impose the
  // gate at the app layer.
  const pkg: PkgRow | null = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id, business_id, file_blob_url, file_key_id
            FROM audit_packages
           WHERE id = ${packageId}::uuid
           LIMIT 1`,
    )) as unknown as PkgRow[];
    return rows[0] ?? null;
  });
  if (!pkg) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Authority check on the business behind this package.
  try {
    await assertCanBuildAuditPackage(me.appUserId, pkg.business_id);
  } catch (err) {
    if (err instanceof AuditPackageAuthorityError) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    throw err;
  }

  // Step-up gate. Hash binds to packageId so a grant for package A
  // cannot release download of package B.
  const payloadHash = computePayloadHash({ packageId });
  try {
    await requireFreshSession({ op: "audit.download_package", payloadHash });
  } catch (err) {
    if (err instanceof StepUpRequired) {
      return Response.json(
        { error: "step_up_required", op: err.op, payloadHash: err.payloadHash },
        { status: 401 },
      );
    }
    throw err;
  }

  if (!pkg.file_blob_url || !pkg.file_key_id) {
    return Response.json({ error: "not_ready" }, { status: 404 });
  }

  let zipBuffer: Buffer;
  try {
    const result = await decryptAuditPackage({
      packageId: pkg.id,
      fileKeyId: pkg.file_key_id,
      fileBlobUrl: pkg.file_blob_url,
    });
    zipBuffer = result.zipBuffer;
  } catch (err) {
    if (err instanceof AuditPackageDekRetiredError) {
      // Crypto-erasure case: the DEK was retired after the package was
      // generated. We surface this as 401 (not 404) because the row
      // still exists but is intentionally unreadable.
      return Response.json({ error: "dek_retired" }, { status: 401 });
    }
    if (err instanceof AuditPackageNotFoundError) {
      return Response.json({ error: "blob_missing" }, { status: 404 });
    }
    throw err;
  }

  const filename = `audit-package-${pkg.id}.zip`;
  const body = new Uint8Array(zipBuffer);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, private",
    },
  });
}
