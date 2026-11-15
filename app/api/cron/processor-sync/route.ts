import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { decryptStringWithDek } from "@/lib/security/encryption";
import { runSyncForCredential } from "@/lib/processor-sync/runSync";

// Processor-sync cron (Plan v4 Phase F.4).
//
// Schedule (vercel.ts crons[]): hourly at minute 17 — staggered so we
// never collide with the morning-brief cron (06:00) or the nightly
// account-purge (03:00).
//
// Auth: same `Authorization: Bearer ${CRON_SECRET}` envelope every
// cron uses. Dev-mode bypass when NODE_ENV !== 'production'.
//
// What this does:
//   1. SELECT every active processor_sync_credentials row.
//   2. For each: decrypt the api_key via the business DEK, then call
//      runSyncForCredential — that helper handles the fetch, pair,
//      and DB writes.
//   3. Aggregate counters across the run for the summary response.
//   4. If a credential has consecutive_failures >= 3 we DON'T attempt
//      it this cycle — it'll be retried on the next hourly tick.
//      This is a soft circuit-breaker; the UI surfaces the failing
//      state separately.

export const dynamic = "force-dynamic";

const MAX_CONSECUTIVE_FAILURES = 3;

type CredentialRow = {
  id: string;
  businessId: string;
  processor: "hyp" | "grow" | "payplus";
  apiKeyCiphertext: string;
  syncCursor: string | null;
  consecutiveFailures: number;
};

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env["CRON_SECRET"];
  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : "";

  if (cronSecret) {
    // Constant-time compare — a `!==` leaks the first-differing byte
    // index to a timing oracle. timingSafeEqual requires equal-length
    // buffers, so length-prefix-guard first to avoid throwing.
    const { timingSafeEqual } = await import("node:crypto");
    const a = Buffer.from(provided);
    const b = Buffer.from(cronSecret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env["NODE_ENV"] === "production") {
    return Response.json({ error: "cron_secret_missing" }, { status: 503 });
  }

  const credentials: CredentialRow[] = await withServiceRole(async (tx) => {
    // Auto-reset stale failure counters every 24h so a credential
    // that hit the failure ceiling during a transient outage can
    // recover without manual intervention. Without this the row was
    // excluded forever — `runSync.ts` only ever resets
    // `consecutive_failures` from inside the cron path that we just
    // excluded the row from. Catch-22.
    await tx.execute(
      sql`UPDATE processor_sync_credentials
            SET consecutive_failures = 0
          WHERE active = true
            AND consecutive_failures >= ${MAX_CONSECUTIVE_FAILURES}
            AND (last_synced_at IS NULL OR last_synced_at < now() - interval '24 hours')`,
    );

    return (await tx.execute(
      sql`SELECT id::text AS id,
                 business_id::text AS "businessId",
                 processor::text AS processor,
                 api_key_ciphertext AS "apiKeyCiphertext",
                 sync_cursor AS "syncCursor",
                 consecutive_failures AS "consecutiveFailures"
            FROM processor_sync_credentials
           WHERE active = true
             AND consecutive_failures < ${MAX_CONSECUTIVE_FAILURES}`,
    )) as unknown as CredentialRow[];
  });

  let totalAttempted = 0;
  let totalFetched = 0;
  let totalPaired = 0;
  let totalOrphans = 0;
  let totalErrors = 0;

  for (const cred of credentials) {
    totalAttempted++;
    let apiKey: string | null = null;
    try {
      const { getActiveDek } = await import("@/lib/security/dek");
      const dek = await getActiveDek(
        `business:${cred.businessId}:processor_credentials`,
      );
      if (!dek) {
        // DEK retired (probably right-of-erasure cron ran) — skip this
        // row and let the operator re-connect.
        totalErrors++;
        continue;
      }
      try {
        apiKey = await decryptStringWithDek({
          dekId: dek.dekId,
          ciphertext: cred.apiKeyCiphertext,
          aad: {
            table: "processor_sync_credentials",
            column: "api_key_ciphertext",
            rowId: cred.id,
          },
        });
      } finally {
        dek.plaintext.fill(0);
      }
    } catch (err) {
      totalErrors++;
      console.warn("[cron.processor-sync] decrypt failed", {
        credentialId: cred.id,
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!apiKey) {
      totalErrors++;
      continue;
    }

    const result = await runSyncForCredential({
      credentialId: cred.id,
      businessId: cred.businessId,
      processor: cred.processor,
      apiKey,
      since: cred.syncCursor ?? undefined,
    });
    // Zero the local plaintext copy.
    apiKey = "0".repeat(apiKey.length);

    if ("error" in result) {
      totalErrors++;
      console.warn("[cron.processor-sync] sync error", {
        credentialId: cred.id,
        processor: cred.processor,
        error: result.error,
      });
    } else {
      totalFetched += result.fetched;
      totalPaired += result.paired;
      totalOrphans += result.orphans;
    }
  }

  const summary = {
    attempted: totalAttempted,
    fetched: totalFetched,
    paired: totalPaired,
    orphans: totalOrphans,
    errors: totalErrors,
    runAt: new Date().toISOString(),
  };
  console.log("[cron.processor-sync] complete", summary);
  return Response.json(summary, { status: 200 });
}
