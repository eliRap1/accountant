import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { composeMorningBrief } from "@/lib/ai/morningBrief";
import {
  upsertMorningBriefNotification,
} from "@/lib/notifications/morningBriefNotifications";
import { pickTemplate, fillText } from "@/lib/email/dispatch";
import { sendEmail } from "@/lib/email/client";
import type { AppLocale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";
import { renderMorningBriefSubject } from "@/lib/ai/morningBriefSentence";

// Morning Tax Brief cron.
//
// Schedule: 06:00 UTC. That's 08:00 Asia/Jerusalem in winter (IST = UTC+2)
// and 09:00 Asia/Jerusalem in summer (IDT = UTC+3). For the MVP we accept
// the 1-hour summer drift — running TWO cron entries (winter + summer)
// is more operational complexity than the daily-habit goal requires.
// When we ship the iOS widget (Phase F.5) and the brief becomes a
// minute-by-minute behaviour we'll add DST handling.
//
// Auth: `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron auto-injects.
//
// Behaviour:
//   1. Iterate users with users.deleted_at IS NULL AND
//      consent_jsonb.morningBriefOptOut !== true.
//   2. For each user → composeMorningBrief({userId, locale}).
//   3. Idempotent UPSERT into notifications (kind='morning_brief',
//      payload.sentDay = today). Repeated runs on the same day are no-ops.
//   4. Best-effort send via Resend (skip-mode in dev/test).
//   5. Append an auth_events row of type 'sign_in' (re-using; we don't
//      have a 'morning_brief_sent' type yet — TODO when schema layer 3
//      lands a notification_audit log). For now we just log to console.

export const dynamic = "force-dynamic";

type DueUserRow = {
  app_user_id: string;
  auth_user_id: string;
  email: string;
  name: string | null;
  locale: string;
};

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env["CRON_SECRET"];
  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : "";

  if (cronSecret) {
    const { timingSafeEqual } = await import("node:crypto");
    const a = Buffer.from(provided);
    const b = Buffer.from(cronSecret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env["NODE_ENV"] === "production") {
    // Fail-safe: refuse to run unauthenticated against production even if
    // someone forgot to set CRON_SECRET.
    return Response.json(
      { error: "cron_secret_missing" },
      { status: 503 },
    );
  }

  let totalScanned = 0;
  let totalComposed = 0;
  let totalSent = 0;
  let totalSkippedDup = 0;
  let totalErrors = 0;

  // 1) Find users eligible for the brief.
  //    Filters:
  //      - Not soft-deleted.
  //      - consent_jsonb.morningBriefOptOut !== true (defaults to opted-in).
  //      - Better Auth `user` row exists (we need the email + name).
  //      - emailVerified — never send to unverified addresses (bounce risk).
  const due: DueUserRow[] = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT u.id::text AS app_user_id,
                 u.auth_user_id AS auth_user_id,
                 u.locale AS locale,
                 b.email AS email,
                 b.name AS name
            FROM users u
            JOIN "user" b ON b.id = u.auth_user_id
           WHERE u.deleted_at IS NULL
             AND b.email_verified = true
             AND COALESCE(b.banned, false) = false
             AND COALESCE(u.consent_jsonb->>'morningBriefOptOut', 'false') <> 'true'`,
    )) as unknown as DueUserRow[];
    return rows;
  });

  totalScanned = due.length;

  for (const row of due) {
    try {
      const locale = pickLocale(row.locale);

      // 2) Compose the brief.
      const payload = await composeMorningBrief({
        userId: row.app_user_id,
        locale,
        userName: row.name,
      });
      totalComposed++;

      // 3) Idempotent upsert.
      const { created } = await upsertMorningBriefNotification({
        userId: row.app_user_id,
        payload,
      });
      if (!created) {
        totalSkippedDup++;
        continue;
      }

      // 4) Skip email when the user has no business or no relevant data.
      //    The notification row is still written (the dashboard card
      //    surfaces it with a "no data yet" affordance), but the email
      //    would be empty — wait for the user to onboard.
      if (!payload.metadata.hasBusiness) {
        continue;
      }

      // 5) Send the email — best effort.
      const template = pickTemplate(locale, "morningBrief");
      const sentence =
        locale.startsWith("he") ? (payload.he ?? "") : (payload.en ?? "");

      const sentenceInput = {
        locale,
        action: payload.actionNext,
        userName: row.name,
        vatDueMinor: payload.vatDueMinor,
        vatDueDate: payload.vatDueDate,
        cashOnHandMinor: payload.cashOnHandMinor,
        cashGapMinor: payload.cashGapMinor,
        pendingReceiptCount: payload.metadata.pendingReceiptCount,
        oldestPendingReceipt: payload.metadata.oldestPendingReceipt
          ? {
              vendor: payload.metadata.oldestPendingReceipt.vendor,
              amountMinor: payload.metadata.oldestPendingReceipt.amountMinor,
            }
          : null,
        overdueInvoiceCount: payload.metadata.overdueInvoiceCount,
        overdueInvoiceTotalMinor: payload.metadata.overdueInvoiceTotalMinor,
      } as const;
      const subject = renderMorningBriefSubject(sentenceInput);

      const dashboardPath = `/${locale}/dashboard`;
      const text = fillText(template.text, {
        url: dashboardPath,
        sentence,
      });

      const result = await sendEmail({
        to: row.email,
        subject,
        react: template.Component({
          user: { email: row.email, name: row.name },
          url: dashboardPath,
          locale,
        }),
        text,
        kind: "support",
        tags: [
          { name: "kind", value: "morning_brief" },
          { name: "action", value: payload.actionNext },
        ],
      });

      if ("id" in result) {
        totalSent++;
      } else {
        totalErrors++;
        console.warn("[cron.morning-brief] send failed", {
          user: row.app_user_id,
          error: result.error,
        });
      }
    } catch (err) {
      totalErrors++;
      console.error("[cron.morning-brief] compose/send error", {
        user: row.app_user_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = {
    scanned: totalScanned,
    composed: totalComposed,
    sent: totalSent,
    skippedDuplicate: totalSkippedDup,
    errors: totalErrors,
    runAt: new Date().toISOString(),
  };
  console.log("[cron.morning-brief] complete", summary);

  return Response.json(summary, { status: 200 });
}

function pickLocale(raw: string): AppLocale {
  const allowed = routing.locales as readonly string[];
  if (allowed.includes(raw)) return raw as AppLocale;
  return "he-IL";
}
