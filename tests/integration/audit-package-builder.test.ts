import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { isRealNeonDb } from "./_helpers";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { user as authUser } from "@/db/schema/auth";
import { users } from "@/db/schema/identity";
import { businesses } from "@/db/schema/businesses";
import { accountantEngagements } from "@/db/schema/engagements";
import {
  assertCanBuildAuditPackage,
  AuditPackageAuthorityError,
  AuditPackageDekRetiredError,
  _decryptInMemoryForTests,
} from "@/lib/audit/packageBuilder";
import { retireDek } from "@/lib/security/dek";

// Capture the wire-format ciphertext that buildAuditPackage would have
// uploaded so the test can decrypt and validate the round-trip without
// hitting a live Vercel Blob endpoint.
let capturedWire: string | null = null;
let capturedUrl: string | null = null;

vi.mock("@vercel/blob", () => ({
  put: async (
    _pathname: string,
    body: string,
  ): Promise<{
    url: string;
    downloadUrl: string;
    pathname: string;
    contentType: string;
    contentDisposition: string;
  }> => {
    capturedWire = body;
    capturedUrl = `https://blob.test.local/${randomUUID()}.bin`;
    return {
      url: capturedUrl,
      downloadUrl: capturedUrl,
      pathname: "test",
      contentType: "application/octet-stream",
      contentDisposition: "",
    };
  },
  get: async () => null,
}));

// Audit Package Builder — end-to-end coverage of Plan v4 § Phase E
// "killer feature" (CPA council § 8). Verifies:
//
//   * authority gate honours owner-OR-engagement-with-filings-AND-ledger
//   * an engagement with a missing scope is rejected
//   * the manifest enumerates every artifact with row-level provenance
//   * the ZIP buffer round-trips through the per-package DEK
//   * once the DEK is retired, decrypt throws AuditPackageDekRetiredError
//     (crypto-erasure case the download path surfaces as HTTP 401)
//
// We bypass the live @vercel/blob round-trip via the test-only
// _decryptInMemoryForTests helper so this test exercises the same wire
// format the route handlers consume without requiring a live blob
// endpoint or BLOB_READ_WRITE_TOKEN in CI.

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

const TAG_PREFIX = `audpkg-builder-${randomUUID().slice(0, 8)}-`;

type Seed = {
  authOwnerId: string;
  appOwnerId: string;
  authViewerId: string;
  appViewerId: string;
  authAccountantId: string;
  appAccountantId: string;
  businessId: string;
  invoiceId: string;
  receiptId: string;
  taxFilingId: string;
};
const state: Partial<Seed> = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/audit-package-builder] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

describeOrSkip("audit package builder — end-to-end", () => {
  beforeAll(async () => {
    await withServiceRole(async (tx) => {
      // ---- 3 users: owner, viewer (no engagement), accountant
      const authOwnerId = `${TAG_PREFIX}owner-${randomUUID()}`;
      const authViewerId = `${TAG_PREFIX}viewer-${randomUUID()}`;
      const authAccountantId = `${TAG_PREFIX}acc-${randomUUID()}`;
      await tx.insert(authUser).values([
        {
          id: authOwnerId,
          name: `${TAG_PREFIX}owner`,
          email: `${TAG_PREFIX}owner@example.test`,
          emailVerified: true,
        },
        {
          id: authViewerId,
          name: `${TAG_PREFIX}viewer`,
          email: `${TAG_PREFIX}viewer@example.test`,
          emailVerified: true,
        },
        {
          id: authAccountantId,
          name: `${TAG_PREFIX}acc`,
          email: `${TAG_PREFIX}acc@example.test`,
          emailVerified: true,
        },
      ]);

      const ownerInserted = await tx
        .insert(users)
        .values({ authUserId: authOwnerId })
        .returning({ id: users.id });
      const viewerInserted = await tx
        .insert(users)
        .values({ authUserId: authViewerId })
        .returning({ id: users.id });
      const accountantInserted = await tx
        .insert(users)
        .values({ authUserId: authAccountantId })
        .returning({ id: users.id });

      const appOwnerId = ownerInserted[0]?.id;
      const appViewerId = viewerInserted[0]?.id;
      const appAccountantId = accountantInserted[0]?.id;
      if (!appOwnerId || !appViewerId || !appAccountantId) {
        throw new Error("seed: missing user ids");
      }

      // ---- Business (owned by `owner`)
      const bizInserted = await tx
        .insert(businesses)
        .values({
          ownerUserId: appOwnerId,
          legalName: `${TAG_PREFIX}biz`,
          vatId: `${TAG_PREFIX}vat`,
          entityType: "hevra_baam",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "double_entry",
        })
        .returning({ id: businesses.id });
      const businessId = bizInserted[0]?.id;
      if (!businessId) throw new Error("seed: missing business id");

      // ---- One invoice in the period (Jan 2026)
      const invoiceRows = (await tx.execute(
        sql`INSERT INTO invoices (
              business_id, invoice_type, sequential_number,
              issue_date, subtotal_minor, vat_minor, total_minor,
              vat_rate, allocation_required_at_issue
            ) VALUES (
              ${businessId}::uuid,
              'tax_invoice'::invoice_type,
              1,
              '2026-01-15'::date,
              100000, 18000, 118000,
              18.00,
              false
            )
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const invoiceId = invoiceRows[0]!.id;

      await tx.execute(
        sql`INSERT INTO invoice_line_items (
              invoice_id, position, description,
              quantity, unit_price_minor, vat_rate, line_total_minor
            ) VALUES (
              ${invoiceId}::uuid,
              1,
              ${"Consulting services"},
              1, 100000, 18.00, 100000
            )`,
      );

      // ---- One receipt in the period
      const receiptRows = (await tx.execute(
        sql`INSERT INTO receipts (
              business_id, status, source,
              parsed_amount_minor, parsed_vat_minor, parsed_date,
              business_use_pct
            ) VALUES (
              ${businessId}::uuid,
              'approved'::receipt_status,
              'manual'::receipt_source,
              5000, 900, '2026-01-10'::date,
              100.00
            )
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const receiptId = receiptRows[0]!.id;

      // ---- One tax_filing in the period
      const filingRows = (await tx.execute(
        sql`INSERT INTO tax_filings (
              business_id, kind, period_start, period_end, generated_by_user_id
            ) VALUES (
              ${businessId}::uuid,
              'pcn874'::tax_filing_kind,
              '2026-01-01'::date,
              '2026-01-31'::date,
              ${appOwnerId}::uuid
            )
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const taxFilingId = filingRows[0]!.id;

      state.authOwnerId = authOwnerId;
      state.appOwnerId = appOwnerId;
      state.authViewerId = authViewerId;
      state.appViewerId = appViewerId;
      state.authAccountantId = authAccountantId;
      state.appAccountantId = appAccountantId;
      state.businessId = businessId;
      state.invoiceId = invoiceId;
      state.receiptId = receiptId;
      state.taxFilingId = taxFilingId;
    });
  });

  afterAll(async () => {
    if (!state.businessId) return;
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`DELETE FROM auth_events WHERE user_id IN (${state.appOwnerId!}, ${state.appViewerId!}, ${state.appAccountantId!})`,
      );
      await tx.execute(
        sql`DELETE FROM audit_packages WHERE business_id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM tax_filings WHERE business_id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM receipts WHERE business_id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = ${state.businessId!}::uuid)`,
      );
      await tx.execute(
        sql`DELETE FROM invoices WHERE business_id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM accountant_engagements WHERE business_id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM businesses WHERE id = ${state.businessId!}::uuid`,
      );
      const uids = [state.appOwnerId, state.appViewerId, state.appAccountantId].filter(
        (x): x is string => Boolean(x),
      );
      for (const id of uids) {
        await tx.execute(sql`DELETE FROM users WHERE id = ${id}::uuid`);
      }
      const authIds = [state.authOwnerId, state.authViewerId, state.authAccountantId].filter(
        (x): x is string => Boolean(x),
      );
      for (const id of authIds) {
        await tx.execute(sql`DELETE FROM "user" WHERE id = ${id}`);
      }
    });
  });

  // ============================================================================
  // Authority gate
  // ============================================================================
  it("authority gate: owner passes", async () => {
    await expect(
      assertCanBuildAuditPackage(state.appOwnerId!, state.businessId!),
    ).resolves.toBeUndefined();
  });

  it("authority gate: viewer (no engagement) rejected", async () => {
    await expect(
      assertCanBuildAuditPackage(state.appViewerId!, state.businessId!),
    ).rejects.toBeInstanceOf(AuditPackageAuthorityError);
  });

  it("authority gate: accountant engagement with only `ai` scope is rejected", async () => {
    // Seed engagement with insufficient scopes.
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`DELETE FROM accountant_engagements WHERE business_id = ${state.businessId!}::uuid AND accountant_user_id = ${state.appAccountantId!}::uuid`,
      );
      await tx.insert(accountantEngagements).values({
        businessId: state.businessId!,
        accountantUserId: state.appAccountantId!,
        role: "accountant",
        acceptedAt: new Date(),
        scopesJsonb: { ai: true },
      });
    });
    await expect(
      assertCanBuildAuditPackage(state.appAccountantId!, state.businessId!),
    ).rejects.toBeInstanceOf(AuditPackageAuthorityError);
  });

  it("authority gate: accountant engagement with filings+ledger passes", async () => {
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`UPDATE accountant_engagements
              SET scopes_jsonb = ${JSON.stringify({ filings: true, ledger: true })}::jsonb,
                  revoked_at = NULL
            WHERE business_id = ${state.businessId!}::uuid
              AND accountant_user_id = ${state.appAccountantId!}::uuid`,
      );
    });
    await expect(
      assertCanBuildAuditPackage(state.appAccountantId!, state.businessId!),
    ).resolves.toBeUndefined();
  });

  // ============================================================================
  // Manifest & encryption round-trip
  // ============================================================================
  it("builds a package, returns a manifest with per-line provenance, and ZIP round-trips through the DEK", async () => {
    const { buildAuditPackage } = await import("@/lib/audit/packageBuilder");

    capturedWire = null;
    capturedUrl = null;

    const result = await buildAuditPackage({
      businessId: state.businessId!,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      requestedByUserId: state.appOwnerId!,
    });

    expect(result.packageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.fileKeyId).toBeTruthy();
    expect(result.encryptedBlobUrl).toContain("blob.test.local");
    expect(capturedWire).toBeTruthy();
    expect(capturedWire!.startsWith("v1:")).toBe(true);

    // Manifest checks — every artifact category we seeded should
    // appear, and each artifact has provenance + a signature hash.
    const m = result.manifest;
    expect(m.invoiceIds).toContain(state.invoiceId);
    expect(m.receiptIds).toContain(state.receiptId);
    expect(m.taxFilingIds).toContain(state.taxFilingId);
    expect(m.artifactCount).toBeGreaterThanOrEqual(3);
    // SHA-256 is returned on the result, NOT embedded in the manifest.
    // The DB UPDATE stores it in audit_packages.sha256_hex; inspectors
    // verify: sha256(decryptedZip) === sha256_hex.
    expect(result.sha256Hex).toMatch(/^[a-f0-9]{64}$/);
    // The manifest must NOT carry the old sha256OfPlaintextZip field.
    expect((m as Record<string, unknown>)["sha256OfPlaintextZip"]).toBeUndefined();
    for (const a of m.artifacts) {
      expect(a.refId).toBeTruthy();
      expect(a.provenance).toBeTruthy();
      expect(a.signatureHash).toMatch(/^[a-f0-9]{64}$/);
    }

    // Decrypt round-trip: feed the captured wire string back through
    // the per-package DEK, parse the resulting ZIP, and confirm the
    // MANIFEST + per-artifact JSON files are present.
    const zipBuffer = await _decryptInMemoryForTests({
      packageId: result.packageId,
      fileKeyId: result.fileKeyId,
      wireCiphertext: capturedWire!,
    });
    expect(zipBuffer.length).toBeGreaterThan(0);

    // Cross-verify the SHA against the actual decrypted ZIP bytes.
    const { createHash } = await import("node:crypto");
    const computedSha = createHash("sha256").update(zipBuffer).digest("hex");
    expect(computedSha).toBe(result.sha256Hex);

    const archive = await JSZip.loadAsync(zipBuffer);
    const manifestEntry = archive.file("MANIFEST.json");
    expect(manifestEntry).toBeTruthy();
    const invoiceEntry = archive.file(`invoice/${state.invoiceId}.json`);
    expect(invoiceEntry).toBeTruthy();
    const receiptEntry = archive.file(`receipt/${state.receiptId}.json`);
    expect(receiptEntry).toBeTruthy();
    const filingEntry = archive.file(`tax_filing/${state.taxFilingId}.json`);
    expect(filingEntry).toBeTruthy();

    // ---- DEK retire path: simulate the crypto-erasure on package
    //      deletion. After retire, the decrypt path MUST refuse.
    await retireDek(result.fileKeyId, "test: simulate package deletion");
    await expect(
      _decryptInMemoryForTests({
        packageId: result.packageId,
        fileKeyId: result.fileKeyId,
        wireCiphertext: capturedWire!,
      }),
    ).rejects.toBeInstanceOf(AuditPackageDekRetiredError);
  });
});
