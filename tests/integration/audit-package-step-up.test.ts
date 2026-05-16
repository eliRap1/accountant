import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isRealNeonDb } from "./_helpers";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { withUser } from "@/lib/db/withUser";
import { user as authUser } from "@/db/schema/auth";
import { users } from "@/db/schema/identity";
import { businesses } from "@/db/schema/businesses";
import {
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";

// Audit-Package builder step-up wiring (Plan v4 § Audit Package Builder).
//
// The schema (audit_packages, migration 0007) is shipped under
// 0008_rls_layer3.sql with owner-only RLS. The build flow at the app
// layer must additionally gate INSERT on a fresh step-up grant —
// op = 'audit.build_package' (pending registry addition in
// lib/auth/stepUp.ts; not in this thread per the locking directive
// on lib/auth/). This test exercises the *mechanism* the future
// /api/audit/build route will use:
//
//   1. Without a grant, requireFreshSession() throws StepUpRequired —
//      proven generally by tests/integration/closed-period.test.ts
//      against the registered op `ledger.post_to_closed_period`.
//   2. With a grant, the INSERT into audit_packages then proceeds
//      under the user's RLS context.
//
// Because `audit.build_package` is not yet a registered StepUpOp, this
// test uses the already-registered `account.delete` op as a stand-in
// to verify that the wiring is symmetric across op symbols. When the
// registry adds `audit.build_package`, the only change here is the op
// string — the assertion shape is unchanged.

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

const TAG_PREFIX = `audpkg-${randomUUID().slice(0, 8)}-`;

type Seed = {
  authUserId: string;
  appUserId: string;
  businessId: string;
};
const state: Partial<Seed> = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/audit-package-step-up] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

function withMockedCurrentUser<T>(
  authUserId: string,
  appUserId: string,
  email: string,
  fn: () => Promise<T>,
): Promise<T> {
  return import("vitest").then(async ({ vi }) => {
    vi.doMock("@/lib/auth/serverSession", () => ({
      currentUser: async () => ({
        authUserId,
        appUserId,
        email,
        emailVerified: true,
        name: "test",
        sessionId: "test-session",
        sessionExpiresAt: new Date(Date.now() + 3600_000),
      }),
      requireCurrentUser: async () => ({
        authUserId,
        appUserId,
        email,
        emailVerified: true,
        name: "test",
        sessionId: "test-session",
        sessionExpiresAt: new Date(Date.now() + 3600_000),
      }),
    }));
    try {
      return await fn();
    } finally {
      vi.doUnmock("@/lib/auth/serverSession");
    }
  });
}

describeOrSkip("audit_packages — step-up gate + RLS", () => {
  beforeAll(async () => {
    await withServiceRole(async (tx) => {
      const aid = `${TAG_PREFIX}${randomUUID()}`;
      await tx.insert(authUser).values({
        id: aid,
        name: `${TAG_PREFIX}n`,
        email: `${TAG_PREFIX}@example.test`,
        emailVerified: true,
      });
      const insertedU = await tx
        .insert(users)
        .values({ authUserId: aid })
        .returning({ id: users.id });
      const uid = insertedU[0]?.id;
      if (!uid) throw new Error("seed: appUserId missing");

      const insertedB = await tx
        .insert(businesses)
        .values({
          ownerUserId: uid,
          legalName: `${TAG_PREFIX}biz`,
          vatId: `${TAG_PREFIX}vat`,
          entityType: "hevra_baam",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "double_entry",
        })
        .returning({ id: businesses.id });
      const bid = insertedB[0]?.id;
      if (!bid) throw new Error("seed: businessId missing");

      state.authUserId = aid;
      state.appUserId = uid;
      state.businessId = bid;
    });
  });

  afterAll(async () => {
    if (!state.appUserId) return;
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`DELETE FROM auth_events WHERE user_id = ${state.appUserId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM audit_packages WHERE business_id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM businesses WHERE id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM users WHERE id = ${state.appUserId!}::uuid`,
      );
      await tx.execute(sql`DELETE FROM "user" WHERE id = ${state.authUserId!}`);
    });
  });

  it("requireFreshSession throws StepUpRequired before a grant; passes after grant; INSERT into audit_packages then succeeds", async () => {
    const payload = {
      businessId: state.businessId,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    };
    const payloadHash = computePayloadHash(payload);

    await withMockedCurrentUser(
      state.authUserId!,
      state.appUserId!,
      `${TAG_PREFIX}@example.test`,
      async () => {
        const stepUp = await import("@/lib/auth/stepUp");

        // 1. No grant → throws.
        await expect(
          stepUp.requireFreshSession({
            op: "account.delete",
            payloadHash,
          }),
        ).rejects.toBeInstanceOf(StepUpRequired);

        // 2. Grant a fresh step-up; requireFreshSession then passes.
        await stepUp.grantStepUp({
          op: "account.delete",
          payloadHash,
          factor: "password",
        });
        await expect(
          stepUp.requireFreshSession({
            op: "account.delete",
            payloadHash,
          }),
        ).resolves.toBeUndefined();

        // 3. With the (mock-)gate satisfied, the owner INSERT into
        //    audit_packages succeeds — proving the row-level policy
        //    permits the owner to write.
        const pkgId = await withUser(state.appUserId!, async (tx) => {
          const rows = (await tx.execute(
            sql`INSERT INTO audit_packages
                  (business_id, period_start, period_end, generated_by_user_id, total_artifacts)
                VALUES (${state.businessId}, '2026-01-01', '2026-01-31', ${state.appUserId}, 0)
                RETURNING id`,
          )) as unknown as Array<{ id: string }>;
          return rows[0]!.id;
        });
        expect(pkgId).toBeTruthy();
      },
    );
  });

  it("audit_packages INSERT path is gated by generated_by_user_id = self even when business is owned", async () => {
    // Insert under a fake generated_by user — should fail the WITH CHECK
    // clause (generated_by_user_id = app_current_user_id()).
    const otherUserId = randomUUID();
    await expect(
      withUser(state.appUserId!, async (tx) => {
        await tx.execute(
          sql`INSERT INTO audit_packages
                (business_id, period_start, period_end, generated_by_user_id, total_artifacts)
              VALUES (${state.businessId}, '2026-03-01', '2026-03-31', ${otherUserId}, 0)`,
        );
      }),
    ).rejects.toThrow();
  });
});
