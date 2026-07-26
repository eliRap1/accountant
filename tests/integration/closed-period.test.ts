import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isRealNeonDb } from "./_helpers";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { withUser } from "@/lib/db/withUser";
import { user as authUser } from "@/db/schema/auth";
import { users } from "@/db/schema/identity";
import { businesses } from "@/db/schema/businesses";
import { yearEndCloses } from "@/db/schema/ledger";
import {
  computePayloadHash,
  grantStepUp,
  requireFreshSession,
  StepUpRequired,
} from "@/lib/auth/stepUp";

// Council C-3: app_period_is_closed must be consulted by ledger writes.
//
// This file exercises the underlying mechanism the server action uses:
//   1. Call app_period_is_closed for a known-closed (business, year).
//      Helper must return true.
//   2. Without a step-up grant, requireFreshSession() throws
//      StepUpRequired for op = ledger.post_to_closed_period.
//   3. With a step-up grant matching the canonical payload hash, the
//      same requireFreshSession() call succeeds.
//   4. A non-closed period (no year_end_closes row for that fiscal_year)
//      returns false — the gate does not engage.
//
// We test the mechanism, not the server-action wrapper, because the
// action's wrapping pulls in next-intl/navigation which is not
// resolvable in vitest's Node ESM context (server-only / react-server
// boundary).

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

const TAG_PREFIX = `cp-${randomUUID().slice(0, 8)}-`;

type Seed = {
  authUserId: string;
  appUserId: string;
  businessId: string;
};
const state: Partial<Seed> = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/closed-period] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

// Mock currentUser so stepUp.ts can attribute grants/checks to the
// seeded test user without going through Better Auth.
function withMockedCurrentUser<T>(
  authUserId: string,
  appUserId: string,
  email: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Lazy import to avoid hoisting the mock above the test seed.
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

describeOrSkip("closed-period guard mechanism (C-3)", () => {
  beforeAll(async () => {
    await withServiceRole(async (tx) => {
      const authId = `${TAG_PREFIX}auth-${randomUUID()}`;
      await tx.insert(authUser).values({
        id: authId,
        name: `${TAG_PREFIX}n`,
        email: `${TAG_PREFIX}@example.test`,
        emailVerified: true,
      });
      const insertedUser = await tx
        .insert(users)
        .values({ authUserId: authId })
        .returning({ id: users.id });
      const appUserId = insertedUser[0]?.id;
      if (!appUserId) throw new Error("seed: appUserId missing");

      const insertedBiz = await tx
        .insert(businesses)
        .values({
          ownerUserId: appUserId,
          legalName: `${TAG_PREFIX}biz`,
          vatId: `${TAG_PREFIX}vat`,
          entityType: "morshe",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "double_entry",
        })
        .returning({ id: businesses.id });
      const businessId = insertedBiz[0]?.id;
      if (!businessId) throw new Error("seed: businessId missing");

      // Seed the year-end close for fiscal_year 2024.
      await tx.insert(yearEndCloses).values({
        businessId,
        fiscalYear: 2024,
        closedByUserId: appUserId,
      });

      state.authUserId = authId;
      state.appUserId = appUserId;
      state.businessId = businessId;
    });
  });

  afterAll(async () => {
    if (!state.appUserId) return;
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`DELETE FROM auth_events WHERE user_id = ${state.appUserId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM journal_lines WHERE entry_id IN (
              SELECT id FROM journal_entries WHERE business_id = ${state.businessId!}::uuid
            )`,
      );
      await tx.execute(
        sql`DELETE FROM journal_entries WHERE business_id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM year_end_closes WHERE business_id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM businesses WHERE id = ${state.businessId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM users WHERE id = ${state.appUserId!}::uuid`,
      );
      await tx.execute(
        sql`DELETE FROM "user" WHERE id = ${state.authUserId!}`,
      );
    });
  });

  it("app_period_is_closed returns true for the seeded closed year", async () => {
    const closed = await withUser(state.appUserId!, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT app_period_is_closed(${state.businessId!}::uuid, '2024-06-15'::date) AS closed`,
      )) as unknown as Array<{ closed: boolean }>;
      return rows[0]?.closed;
    });
    expect(closed).toBe(true);
  });

  it("app_period_is_closed returns false for an open year", async () => {
    const closed = await withUser(state.appUserId!, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT app_period_is_closed(${state.businessId!}::uuid, '2099-01-15'::date) AS closed`,
      )) as unknown as Array<{ closed: boolean }>;
      return rows[0]?.closed;
    });
    expect(closed).toBe(false);
  });

  it("requireFreshSession throws StepUpRequired without a grant; passes after grantStepUp for the matching hash", async () => {
    const lines = [
      { accountCode: "1010", debitMinor: 1000, creditMinor: 0 },
      { accountCode: "4000", debitMinor: 0, creditMinor: 1000 },
    ];
    const payloadHash = computePayloadHash({
      businessId: state.businessId,
      entryDate: "2024-06-15",
      lines,
    });

    await withMockedCurrentUser(
      state.authUserId!,
      state.appUserId!,
      `${TAG_PREFIX}@example.test`,
      async () => {
        // Re-import after mock so stepUp.ts picks up the mocked
        // currentUser. (vi.doMock invalidates the module registry only
        // for subsequent imports.)
        const stepUp = await import("@/lib/auth/stepUp");

        // 1. No grant → throws.
        await expect(
          stepUp.requireFreshSession({
            op: "ledger.post_to_closed_period",
            payloadHash,
          }),
        ).rejects.toBeInstanceOf(StepUpRequired);

        // 2. Grant with matching hash → passes.
        await stepUp.grantStepUp({
          op: "ledger.post_to_closed_period",
          payloadHash,
          factor: "password",
        });

        await expect(
          stepUp.requireFreshSession({
            op: "ledger.post_to_closed_period",
            payloadHash,
          }),
        ).resolves.toBeUndefined();

        // 3. Different payload hash → still throws (binding works).
        const otherHash = computePayloadHash({
          businessId: state.businessId,
          entryDate: "2024-12-31",
          lines,
        });
        await expect(
          stepUp.requireFreshSession({
            op: "ledger.post_to_closed_period",
            payloadHash: otherHash,
          }),
        ).rejects.toBeInstanceOf(StepUpRequired);
      },
    );
  });

  it("step-up grant TTL — expired grants no longer satisfy requireFreshSession", async () => {
    const payloadHash = computePayloadHash({ probe: "ttl-test" });
    await withMockedCurrentUser(
      state.authUserId!,
      state.appUserId!,
      `${TAG_PREFIX}@example.test`,
      async () => {
        const stepUp = await import("@/lib/auth/stepUp");
        await stepUp.grantStepUp({
          op: "ledger.post_to_closed_period",
          payloadHash,
          factor: "password",
        });
        // maxAgeSec=0 → window already closed.
        await expect(
          stepUp.requireFreshSession({
            op: "ledger.post_to_closed_period",
            payloadHash,
            maxAgeSec: 0,
          }),
        ).rejects.toBeInstanceOf(StepUpRequired);
      },
    );
  });
});

// Static-import sanity: ensure the helpers we expose for production
// callers are reachable (not tree-shaken under test). This catches a
// regression where stepUp.ts re-exports change shape.
describe("stepUp module surface", () => {
  it("exports requireFreshSession, grantStepUp, computePayloadHash, StepUpRequired", () => {
    expect(typeof requireFreshSession).toBe("function");
    expect(typeof grantStepUp).toBe("function");
    expect(typeof computePayloadHash).toBe("function");
    expect(new StepUpRequired("account.delete", "x")).toBeInstanceOf(Error);
  });
});
