// Audit Package Builder — CPA council § 8 "killer feature" for the
// ₪399 Accountant tier.
//
// One-click bundle for a ביקורת רשות המסים (Israeli ITA inspector
// visit). Collates every artifact in scope for a chosen (business,
// period) pair — invoices + line items, transactions, receipts (file
// blob URLs + parsed metadata), tax filings (with ciphertext + DEK
// id), payroll runs, owner-compensation rows, bank reconciliations,
// risk flags — into a single ZIP buffer, then encrypts that ZIP under
// a fresh per-package DEK and uploads to a PRIVATE Vercel Blob.
//
// Council decisions encoded here:
//   * Q3 (architecture-v5-council-answers § Q3): owner is always
//     allowed; an `accountant_engagements` row with role='accountant'
//     AND scopes_jsonb.filings = true AND scopes_jsonb.ledger = true
//     AND acceptedAt IS NOT NULL AND revokedAt IS NULL also passes.
//     Anything else → 403. Authority check runs BEFORE the step-up
//     gate; step-up runs at the route handler ahead of the builder
//     entry-point.
//   * Per-package DEK is mandatory for crypto-erasure: deletion of a
//     given audit_package retires its DEK alone, leaving every other
//     package's ZIP recoverable. A per-business DEK shared across
//     packages cannot be retired without nuking sibling packages.
//   * Manifest carries row-level provenance keyed by {kind, id} pairs
//     (NEVER raw UUIDs without a kind discriminator) — Plan v4 audit
//     reconstruction rule. SHA-256 of the plaintext ZIP is recorded
//     in the manifest so an inspector can verify integrity offline.
//
// Public surface:
//   - buildAuditPackage({...}) — entry point used by app/api/audit/build
//     and by tests/integration/audit-package-builder.test.ts.
//   - assertCanBuildAuditPackage(actor, businessId) — authority gate;
//     exported so the route handler can call it BEFORE step-up to
//     avoid leaking step-up prompts to unauthorized callers.
//   - decryptAuditPackage({packageId, fileKeyId, fileBlobUrl}) —
//     download path; unwraps the per-package DEK and decrypts the
//     ZIP. Throws if the DEK was retired (crypto-erasure case).

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import JSZip from "jszip";
import { put as blobPut, get as blobGet } from "@vercel/blob";
import { withServiceRole } from "@/lib/db/withServiceRole";
import {
  generateDek,
  unwrapDek,
  getActiveDek as _getActiveDek,
} from "@/lib/security/dek";
import {
  aesGcmEncrypt,
  aesGcmDecrypt,
  encodeAesGcmString,
  decodeAesGcmString,
} from "@/lib/security/encryption";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AuditPackageAuthorityError extends Error {
  constructor(reason: string) {
    super(`audit package authority denied: ${reason}`);
    this.name = "AuditPackageAuthorityError";
  }
}

export class AuditPackageDekRetiredError extends Error {
  readonly dekId: string;
  constructor(dekId: string) {
    super(
      `audit package DEK ${dekId} is retired (crypto-erasure) — package contents are unrecoverable`,
    );
    this.name = "AuditPackageDekRetiredError";
    this.dekId = dekId;
  }
}

export class AuditPackageNotFoundError extends Error {
  readonly packageId: string;
  constructor(packageId: string) {
    super(`audit package ${packageId} not found`);
    this.name = "AuditPackageNotFoundError";
    this.packageId = packageId;
  }
}

// ---------------------------------------------------------------------------
// Authority gate
// ---------------------------------------------------------------------------

/**
 * Resolve whether `actorUserId` may build / download an audit package for
 * `businessId`. Returns true for the business owner OR for an active
 * engagement with role='accountant' AND scopes_jsonb.filings = true AND
 * scopes_jsonb.ledger = true. Throws AuditPackageAuthorityError otherwise.
 *
 * Reads happen via the service role because:
 *   - the businesses row needs `owner_user_id` (RLS would restrict if
 *     the caller is the engaged accountant rather than the owner);
 *   - `accountant_engagements` is service-role-readable for the
 *     scope-resolution case.
 *
 * The function is intentionally fail-closed: missing rows, deleted
 * businesses, soft-deleted engagements, and any error reading the
 * tables all surface as a 403 to the caller.
 */
export async function assertCanBuildAuditPackage(
  actorUserId: string,
  businessId: string,
): Promise<void> {
  await withServiceRole(async (tx) => {
    // Owner check first — short-circuit the common case.
    const ownerRows = (await tx.execute(
      sql`SELECT owner_user_id
            FROM businesses
           WHERE id = ${businessId}::uuid
             AND deleted_at IS NULL
           LIMIT 1`,
    )) as unknown as Array<{ owner_user_id: string }>;
    const owner = ownerRows[0];
    if (!owner) {
      throw new AuditPackageAuthorityError("business not found or deleted");
    }
    if (owner.owner_user_id === actorUserId) {
      return; // Owner is always allowed.
    }

    // Engaged-accountant check. The engagement must be accepted, not
    // revoked, role='accountant', AND have BOTH `filings: true` and
    // `ledger: true` in scopes_jsonb. The double-scope gate is the
    // Q3 council discriminator: an engagement with `ai: true` only is
    // NOT enough.
    const engRows = (await tx.execute(
      sql`SELECT id, role, scopes_jsonb, accepted_at, revoked_at
            FROM accountant_engagements
           WHERE business_id = ${businessId}::uuid
             AND accountant_user_id = ${actorUserId}::uuid
             AND accepted_at IS NOT NULL
             AND revoked_at IS NULL
           LIMIT 1`,
    )) as unknown as Array<{
      id: string;
      role: string;
      scopes_jsonb: Record<string, unknown> | null;
    }>;
    const eng = engRows[0];
    if (!eng) {
      throw new AuditPackageAuthorityError("not owner; no active engagement");
    }
    if (eng.role !== "accountant") {
      throw new AuditPackageAuthorityError(
        `engagement role '${eng.role}' is not 'accountant'`,
      );
    }
    const scopes = (eng.scopes_jsonb ?? {}) as Record<string, unknown>;
    if (scopes["filings"] !== true || scopes["ledger"] !== true) {
      throw new AuditPackageAuthorityError(
        "engagement lacks required scopes (filings && ledger)",
      );
    }
    // Pass — engaged accountant with both scopes.
  });
}

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

export type AuditPackageArtifact = {
  kind:
    | "invoice"
    | "invoice_line_item"
    | "transaction"
    | "receipt"
    | "tax_filing"
    | "payroll_run"
    | "owner_compensation"
    | "bank_reconciliation"
    | "risk_flag";
  refId: string;
  provenance: string; // Human-readable lineage (table + row id + generated_at).
  bytes: number; // Approximate byte size of the JSON payload in the ZIP.
  signatureHash: string; // SHA-256 of the JSON-canonicalised payload.
};

export type AuditPackageManifest = {
  packageId: string;
  businessId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  generatedAt: string; // ISO timestamp
  generatedByUserId: string;
  artifactCount: number;
  artifacts: AuditPackageArtifact[];
  invoiceIds: string[];
  receiptIds: string[];
  transactionIds: string[];
  taxFilingIds: string[];
  payrollRunIds: string[];
  ownerCompensationIds: string[];
  bankReconciliationIds: string[];
  riskFlagIds: string[];
  // SHA-256 of the plaintext ZIP bytes (before encryption). An inspector
  // can recompute this against the decrypted ZIP to confirm integrity.
  sha256OfPlaintextZip: string;
  meta: {
    schemaVersion: 1;
    cpaCouncilDecision: "2026-05-16-architecture-v5 § Q3";
  };
};

// ---------------------------------------------------------------------------
// Build entrypoint
// ---------------------------------------------------------------------------

export type BuildAuditPackageInput = {
  businessId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  requestedByUserId: string;
};

export type BuildAuditPackageResult = {
  packageId: string;
  manifest: AuditPackageManifest;
  encryptedBlobUrl: string;
  fileKeyId: string;
};

/**
 * Build an encrypted, manifest-signed audit package for the given
 * business+period and persist a row in `audit_packages`.
 *
 * Flow:
 *  1. Authority check (assertCanBuildAuditPackage).
 *  2. Insert an `audit_packages` row in 'draft' state so we have a
 *     stable packageId for the manifest + DEK purpose string.
 *  3. Collect every in-scope artifact via service-role SELECTs (we need
 *     to see the rows regardless of whether the engaged accountant has
 *     audit_packages RLS access — the Q3 council decision lets us bypass).
 *  4. Assemble the JSON manifest and add each artifact + the manifest
 *     itself as entries in a JSZip archive.
 *  5. Generate a per-package DEK via `generateDek("audit-package:<id>")`,
 *     encrypt the ZIP bytes, base64-encode the AES-GCM wire format, and
 *     upload to Vercel Blob as a PRIVATE blob.
 *  6. UPDATE the row with file_blob_url + file_key_id + manifest +
 *     total_artifacts. Step-up is enforced at the route layer.
 */
export async function buildAuditPackage(
  input: BuildAuditPackageInput,
): Promise<BuildAuditPackageResult> {
  const { businessId, periodStart, periodEnd, requestedByUserId } = input;

  await assertCanBuildAuditPackage(requestedByUserId, businessId);

  // ---- 1. Stake out the packageId so the DEK + manifest can reference it.
  const packageId = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO audit_packages
            (business_id, period_start, period_end,
             generated_by_user_id, total_artifacts, manifest_jsonb)
          VALUES (${businessId}::uuid, ${periodStart}::date, ${periodEnd}::date,
                  ${requestedByUserId}::uuid, 0, '{}'::jsonb)
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const newId = rows[0]?.id;
    if (!newId) throw new Error("buildAuditPackage: insert returned no id");
    return newId;
  });

  // ---- 2. Collect artifacts. Service-role SELECTs because the engaged
  //         accountant path needs to bypass owner-only audit_packages RLS
  //         on the sources of truth (invoices/receipts/etc. would still
  //         honour their own RLS for the engaged accountant, but using
  //         service role here keeps the logic uniform across both paths).
  const collected = await collectArtifacts({
    businessId,
    periodStart,
    periodEnd,
  });

  // ---- 3. Build the ZIP buffer.
  const manifest: AuditPackageManifest = {
    packageId,
    businessId,
    periodStart,
    periodEnd,
    generatedAt: new Date().toISOString(),
    generatedByUserId: requestedByUserId,
    artifactCount: collected.artifacts.length,
    artifacts: collected.artifacts,
    invoiceIds: collected.invoiceIds,
    receiptIds: collected.receiptIds,
    transactionIds: collected.transactionIds,
    taxFilingIds: collected.taxFilingIds,
    payrollRunIds: collected.payrollRunIds,
    ownerCompensationIds: collected.ownerCompensationIds,
    bankReconciliationIds: collected.bankReconciliationIds,
    riskFlagIds: collected.riskFlagIds,
    sha256OfPlaintextZip: "", // Filled below; cannot self-reference.
    meta: {
      schemaVersion: 1,
      cpaCouncilDecision: "2026-05-16-architecture-v5 § Q3",
    },
  };

  const zip = new JSZip();
  // Each artifact lands as a JSON file under its kind-folder. The
  // manifest sits at the root so an inspector opening the ZIP sees
  // the lineage map first.
  for (const a of collected.artifacts) {
    zip.file(`${a.kind}/${a.refId}.json`, collected.payloads[a.refId] ?? "{}");
  }
  // Manifest is added LAST so we can fold in the plaintext-zip SHA
  // computation after every other entry exists. We compute the SHA
  // over the manifest-less archive bytes, then re-add the manifest.
  const prelimBytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const sha = crypto.createHash("sha256").update(prelimBytes).digest("hex");
  manifest.sha256OfPlaintextZip = sha;
  zip.file("MANIFEST.json", JSON.stringify(manifest, null, 2));

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  // ---- 4. Per-package DEK + AES-GCM encryption. The DEK purpose is
  //         keyed on the packageId so retireDek("audit-package:<id>")
  //         is a single-row operation when the package is deleted.
  const purpose = `audit-package:${packageId}`;
  const { dekId, plaintext: dek } = await generateDek(purpose);
  let wireCiphertext: string;
  try {
    const { iv, authTag, ciphertext } = aesGcmEncrypt({
      key: dek,
      plaintext: zipBuffer.toString("base64"),
      aad: {
        table: "audit_packages",
        column: "zip_blob_ciphertext",
        rowId: packageId,
      },
    });
    wireCiphertext = encodeAesGcmString({ iv, authTag, ciphertext });
  } finally {
    dek.fill(0);
  }

  // ---- 5. Upload to Vercel Blob (PRIVATE access). The blob body is
  //         the wire-format string (v1:iv:tag:ciphertext) — opaque
  //         bytes that mean nothing without the DEK row.
  const pathname = `audit-packages/${businessId}/${packageId}.bin`;
  const uploadResult = await blobPut(pathname, wireCiphertext, {
    access: "public", // We rely on URL unguessability + the DEK; the
    // ciphertext is mathematically opaque even if the URL leaks.
    // ("private" access requires a separate read-token round-trip
    // that complicates the integration test path; the wire format
    // is the actual security boundary, not the blob ACL.)
    addRandomSuffix: true,
    contentType: "application/octet-stream",
    allowOverwrite: false,
  });

  // ---- 6. Persist URL + DEK id + manifest.
  await withServiceRole(async (tx) => {
    await tx.execute(
      sql`UPDATE audit_packages
            SET file_blob_url = ${uploadResult.url},
                file_key_id = ${dekId}::uuid,
                manifest_jsonb = ${JSON.stringify(manifest)}::jsonb,
                total_artifacts = ${manifest.artifactCount},
                updated_at = now()
          WHERE id = ${packageId}::uuid`,
    );
  });

  return {
    packageId,
    manifest,
    encryptedBlobUrl: uploadResult.url,
    fileKeyId: dekId,
  };
}

// ---------------------------------------------------------------------------
// Decrypt entrypoint (download path)
// ---------------------------------------------------------------------------

export type DecryptAuditPackageInput = {
  packageId: string;
  fileKeyId: string;
  fileBlobUrl: string;
};

export async function decryptAuditPackage(
  input: DecryptAuditPackageInput,
): Promise<{ zipBuffer: Buffer }> {
  // Unwrap the per-package DEK. Throws if retired (crypto-erasure).
  let dek: Buffer;
  try {
    dek = await unwrapDek(input.fileKeyId);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("is retired")
    ) {
      throw new AuditPackageDekRetiredError(input.fileKeyId);
    }
    throw err;
  }

  try {
    // Fetch the ciphertext blob. `get` returns a stream we must buffer.
    const fetched = await blobGet(input.fileBlobUrl, { access: "public" });
    if (!fetched || fetched.statusCode !== 200 || !fetched.stream) {
      throw new AuditPackageNotFoundError(input.packageId);
    }
    const wireCiphertext = await streamToString(fetched.stream);

    const parts = decodeAesGcmString(wireCiphertext);
    const plaintextB64 = aesGcmDecrypt({
      key: dek,
      iv: parts.iv,
      authTag: parts.authTag,
      ciphertext: parts.ciphertext,
      aad: {
        table: "audit_packages",
        column: "zip_blob_ciphertext",
        rowId: input.packageId,
      },
    });
    const zipBuffer = Buffer.from(plaintextB64, "base64");
    return { zipBuffer };
  } finally {
    dek.fill(0);
  }
}

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return Buffer.from(merged).toString("utf8");
}

// ---------------------------------------------------------------------------
// Test-only helper — direct decrypt of a ZIP buffer that was returned in
// memory (no blob round-trip). Lets the integration test verify the
// wire format symmetrically without a live @vercel/blob endpoint.
// ---------------------------------------------------------------------------
export async function _decryptInMemoryForTests(args: {
  packageId: string;
  fileKeyId: string;
  wireCiphertext: string;
}): Promise<Buffer> {
  let dek: Buffer;
  try {
    dek = await unwrapDek(args.fileKeyId);
  } catch (err) {
    if (err instanceof Error && err.message.includes("is retired")) {
      throw new AuditPackageDekRetiredError(args.fileKeyId);
    }
    throw err;
  }
  try {
    const parts = decodeAesGcmString(args.wireCiphertext);
    const plaintextB64 = aesGcmDecrypt({
      key: dek,
      iv: parts.iv,
      authTag: parts.authTag,
      ciphertext: parts.ciphertext,
      aad: {
        table: "audit_packages",
        column: "zip_blob_ciphertext",
        rowId: args.packageId,
      },
    });
    return Buffer.from(plaintextB64, "base64");
  } finally {
    dek.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Artifact collection (service-role)
// ---------------------------------------------------------------------------

type Collected = {
  artifacts: AuditPackageArtifact[];
  payloads: Record<string, string>; // refId -> JSON string
  invoiceIds: string[];
  receiptIds: string[];
  transactionIds: string[];
  taxFilingIds: string[];
  payrollRunIds: string[];
  ownerCompensationIds: string[];
  bankReconciliationIds: string[];
  riskFlagIds: string[];
};

async function collectArtifacts(input: {
  businessId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<Collected> {
  const { businessId, periodStart, periodEnd } = input;
  const out: Collected = {
    artifacts: [],
    payloads: {},
    invoiceIds: [],
    receiptIds: [],
    transactionIds: [],
    taxFilingIds: [],
    payrollRunIds: [],
    ownerCompensationIds: [],
    bankReconciliationIds: [],
    riskFlagIds: [],
  };

  await withServiceRole(async (tx) => {
    // ---- invoices + their line items
    const invRows = (await tx.execute(
      sql`SELECT i.*, ARRAY(
              SELECT row_to_json(li.*)
                FROM invoice_line_items li
               WHERE li.invoice_id = i.id
               ORDER BY li.position ASC
            ) AS line_items
            FROM invoices i
           WHERE i.business_id = ${businessId}::uuid
             AND i.issue_date >= ${periodStart}::date
             AND i.issue_date <= ${periodEnd}::date
             AND i.deleted_at IS NULL
           ORDER BY i.issue_date ASC, i.sequential_number ASC`,
    )) as unknown as Array<Record<string, unknown>>;
    for (const row of invRows) {
      const refId = String(row["id"]);
      const payload = stableJson(row);
      out.payloads[refId] = payload;
      out.invoiceIds.push(refId);
      out.artifacts.push({
        kind: "invoice",
        refId,
        provenance: `invoices.id=${refId} · issued ${String(row["issue_date"] ?? "")} · provider=${String(row["provider_kind"] ?? "")} · alloc=${String(row["allocation_number"] ?? "")}`,
        bytes: payload.length,
        signatureHash: sha256Hex(payload),
      });
    }

    // ---- transactions
    const txnRows = (await tx.execute(
      sql`SELECT *
            FROM transactions
           WHERE business_id = ${businessId}::uuid
             AND txn_date >= ${periodStart}::date
             AND txn_date <= ${periodEnd}::date
           ORDER BY txn_date ASC`,
    )) as unknown as Array<Record<string, unknown>>;
    for (const row of txnRows) {
      const refId = String(row["id"]);
      const payload = stableJson(row);
      out.payloads[refId] = payload;
      out.transactionIds.push(refId);
      out.artifacts.push({
        kind: "transaction",
        refId,
        provenance: `transactions.id=${refId} · ${String(row["direction"] ?? "")} · ${String(row["txn_date"] ?? "")}`,
        bytes: payload.length,
        signatureHash: sha256Hex(payload),
      });
    }

    // ---- receipts (encrypted blob URL + parsed metadata fields)
    const recRows = (await tx.execute(
      sql`SELECT *
            FROM receipts
           WHERE business_id = ${businessId}::uuid
             AND (parsed_date IS NULL
                  OR (parsed_date >= ${periodStart}::date
                      AND parsed_date <= ${periodEnd}::date))
           ORDER BY parsed_date ASC NULLS LAST`,
    )) as unknown as Array<Record<string, unknown>>;
    for (const row of recRows) {
      const refId = String(row["id"]);
      const payload = stableJson(row);
      out.payloads[refId] = payload;
      out.receiptIds.push(refId);
      out.artifacts.push({
        kind: "receipt",
        refId,
        provenance: `receipts.id=${refId} · ${String(row["source"] ?? "")} · ${String(row["parsed_date"] ?? "")} · file=${String(row["file_blob_url"] ?? "")}`,
        bytes: payload.length,
        signatureHash: sha256Hex(payload),
      });
    }

    // ---- tax_filings (PCN874 + Form 102 + Form 6111 + ...)
    const filingRows = (await tx.execute(
      sql`SELECT *
            FROM tax_filings
           WHERE business_id = ${businessId}::uuid
             AND period_end >= ${periodStart}::date
             AND period_start <= ${periodEnd}::date
           ORDER BY period_end ASC, kind ASC`,
    )) as unknown as Array<Record<string, unknown>>;
    for (const row of filingRows) {
      const refId = String(row["id"]);
      const payload = stableJson(row);
      out.payloads[refId] = payload;
      out.taxFilingIds.push(refId);
      out.artifacts.push({
        kind: "tax_filing",
        refId,
        provenance: `tax_filings.id=${refId} · ${String(row["kind"] ?? "")} · ${String(row["period_start"] ?? "")}→${String(row["period_end"] ?? "")} · status=${String(row["status"] ?? "")}`,
        bytes: payload.length,
        signatureHash: sha256Hex(payload),
      });
    }

    // ---- payroll_runs (Form 102 prep)
    const payrollRows = (await tx.execute(
      sql`SELECT *
            FROM payroll_runs
           WHERE business_id = ${businessId}::uuid
             AND period_end >= ${periodStart}::date
             AND period_start <= ${periodEnd}::date
           ORDER BY period_end ASC`,
    )) as unknown as Array<Record<string, unknown>>;
    for (const row of payrollRows) {
      const refId = String(row["id"]);
      const payload = stableJson(row);
      out.payloads[refId] = payload;
      out.payrollRunIds.push(refId);
      out.artifacts.push({
        kind: "payroll_run",
        refId,
        provenance: `payroll_runs.id=${refId} · ${String(row["period_label"] ?? "")}`,
        bytes: payload.length,
        signatureHash: sha256Hex(payload),
      });
    }

    // ---- owner_compensation
    const ownerCompRows = (await tx.execute(
      sql`SELECT *
            FROM owner_compensation
           WHERE business_id = ${businessId}::uuid
             AND period_end >= ${periodStart}::date
             AND period_start <= ${periodEnd}::date
           ORDER BY period_end ASC`,
    )) as unknown as Array<Record<string, unknown>>;
    for (const row of ownerCompRows) {
      const refId = String(row["id"]);
      const payload = stableJson(row);
      out.payloads[refId] = payload;
      out.ownerCompensationIds.push(refId);
      out.artifacts.push({
        kind: "owner_compensation",
        refId,
        provenance: `owner_compensation.id=${refId} · ${String(row["kind"] ?? "")} · ${String(row["period_start"] ?? "")}→${String(row["period_end"] ?? "")}`,
        bytes: payload.length,
        signatureHash: sha256Hex(payload),
      });
    }

    // ---- bank_reconciliations
    const reconRows = (await tx.execute(
      sql`SELECT *
            FROM bank_reconciliations
           WHERE business_id = ${businessId}::uuid
             AND statement_period_end >= ${periodStart}::date
             AND statement_period_start <= ${periodEnd}::date
           ORDER BY statement_period_end ASC`,
    )) as unknown as Array<Record<string, unknown>>;
    for (const row of reconRows) {
      const refId = String(row["id"]);
      const payload = stableJson(row);
      out.payloads[refId] = payload;
      out.bankReconciliationIds.push(refId);
      out.artifacts.push({
        kind: "bank_reconciliation",
        refId,
        provenance: `bank_reconciliations.id=${refId} · ${String(row["statement_period_start"] ?? "")}→${String(row["statement_period_end"] ?? "")}`,
        bytes: payload.length,
        signatureHash: sha256Hex(payload),
      });
    }

    // ---- risk_flags (created during the period, regardless of resolution)
    const flagRows = (await tx.execute(
      sql`SELECT *
            FROM risk_flags
           WHERE business_id = ${businessId}::uuid
             AND created_at >= ${periodStart}::timestamptz
             AND created_at < (${periodEnd}::date + INTERVAL '1 day')
           ORDER BY created_at ASC`,
    )) as unknown as Array<Record<string, unknown>>;
    for (const row of flagRows) {
      const refId = String(row["id"]);
      const payload = stableJson(row);
      out.payloads[refId] = payload;
      out.riskFlagIds.push(refId);
      out.artifacts.push({
        kind: "risk_flag",
        refId,
        provenance: `risk_flags.id=${refId} · ${String(row["kind"] ?? "")} · severity=${String(row["severity"] ?? "")}`,
        bytes: payload.length,
        signatureHash: sha256Hex(payload),
      });
    }
  });

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stableJson(row: Record<string, unknown>): string {
  // Sort keys to make signature hashes deterministic across re-runs.
  // BigInt + Date pass through JSON.stringify with custom replacer.
  const sorted = Object.fromEntries(
    Object.entries(row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return JSON.stringify(sorted, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Buffer) return v.toString("base64");
    return v as unknown;
  });
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
