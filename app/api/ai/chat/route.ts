// POST /api/ai/chat
//
// AI Tax Advisor streaming endpoint (Phase D).
//
// Contract:
//   - Body: { messages: UIMessage[], conversationId?: string, locale?: string }
//   - Streams a UI Message Stream (AI SDK v6) back to the client.
//   - The response is post-processed via `ensureDisclaimer` in onFinish:
//     the assembled assistant text is concatenated, run through
//     `ensureDisclaimer(text, locale)`, and persisted into `ai_messages`
//     IFF the table exists (Layer 1 dep). The disclaimer is the
//     legal-enforcement seam — every stored AI message has it.
//
// API surface verified 2026-05-16 against the locally-installed
// `ai@^6.0.183`:
//   - `streamText(...).toUIMessageStreamResponse({ headers, onFinish })`
//     returns a `Response` carrying the UI Message Stream protocol.
//   - The stream chunks include `text-start`, `text-delta`, `text-end`,
//     tool-input parts, and a terminal `error` part.
//
// Quota enforcement: `plan_entitlements.ai.messages_per_month_max` is
// looked up via the user's active subscription. value_int = -1 means
// "unlimited". value_int = 0 → hard-block. Anything else → soft-warn at
// 80% utilisation, hard-block at 100%. Storage for the running counter
// is TBD (Layer 1 dep on `ai_messages.user_id`+`created_at`); for now we
// log + warn at the user level and hard-block on the literal cap, with
// the bucket falling back to "exists 0 messages this month" when the
// table is missing.

import { sql } from "drizzle-orm";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import {
  isAiGatewayEnabled,
  requireDefaultModel,
} from "@/lib/ai/gateway";
import {
  ensureDisclaimer,
  IL_TAX_ADVISOR_SYSTEM_PROMPT,
} from "@/lib/ai/prompt";
import { generateSnapshotContext } from "@/lib/ai/snapshot";
import { buildAdvisorTools } from "@/lib/ai/tools";

// Lightweight logger shim. pino lands with Phase A.6; for now we go
// through console.* so server logs surface in Vercel without crashing
// the build. The shim preserves the structured-log call signature so a
// swap to `logger.child({ scope })` is a single-file change later.
const log = {
  child: (_ctx: Record<string, unknown>) => log,
  info: (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.info("[api.ai.chat]", ...args);
  },
  warn: (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.warn("[api.ai.chat]", ...args);
  },
  error: (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.error("[api.ai.chat]", ...args);
  },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Node streaming + cookie-bound auth — Edge would require a Better
// Auth adapter we don't currently ship.

type RequestBody = {
  messages?: unknown;
  conversationId?: unknown;
  locale?: unknown;
};

type EntitlementRow = { value_int: number | null };
type ProbeRow = { exists_count: string };

async function getMonthlyMessageQuota(userId: string): Promise<number | null> {
  // Read the user's active subscription plan + the AI messages cap. If
  // any of these are missing, fall back to a permissive default for dev
  // (return null → "unlimited"). Production paths still hit the
  // entitlement table because the seed migrates default entitlements.
  try {
    const rows = await withServiceRole(async (tx) => {
      return (await tx.execute(
        sql`SELECT pe.value_int
            FROM plan_entitlements pe
            JOIN subscriptions s ON s.plan_id = pe.plan_id
            WHERE s.user_id = ${userId}::uuid
              AND s.status IN ('active','trialing')
              AND pe.key = 'ai.messages_per_month_max'
            ORDER BY s.created_at DESC
            LIMIT 1`,
      )) as unknown as EntitlementRow[];
    });
    if (rows.length === 0) {
      // Default tier ("free") seed sets the cap to 0 — no AI messages.
      // No subscription row → treat as "free" → 0.
      const freeRows = await withServiceRole(async (tx) => {
        return (await tx.execute(
          sql`SELECT value_int
              FROM plan_entitlements
              WHERE plan_id = 'free'
                AND key = 'ai.messages_per_month_max'
              LIMIT 1`,
        )) as unknown as EntitlementRow[];
      });
      return freeRows[0]?.value_int ?? 0;
    }
    return rows[0]?.value_int ?? 0;
  } catch (err) {
    log.warn({ err }, "ai.quota.lookup_failed");
    return null;
  }
}

async function countMessagesThisMonth(userId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const iso = monthStart.toISOString().slice(0, 10);
  try {
    const rows = await withUser(userId, async (tx) => {
      // Probe first so missing tables don't surface as an opaque pg error.
      const probe = (await tx.execute(
        sql`SELECT COUNT(*)::text AS exists_count
            FROM information_schema.tables
            WHERE table_name = 'ai_messages'`,
      )) as unknown as ProbeRow[];
      const exists = Number(probe[0]?.exists_count ?? "0") > 0;
      if (!exists) return [{ count: "0" }];
      return (await tx.execute(
        sql`SELECT COUNT(*)::text AS count
            FROM ai_messages
            WHERE created_at >= ${iso}::date
              AND role = 'user'`,
      )) as unknown as Array<{ count: string }>;
    });
    return Number(rows[0]?.count ?? "0");
  } catch {
    return 0;
  }
}

async function persistMessageBestEffort(args: {
  userId: string;
  conversationId: string | null;
  role: "user" | "assistant";
  text: string;
}): Promise<void> {
  // Insert into ai_messages when the table exists. AAD per spec:
  // {table:'ai_messages', column:'content_ciphertext', rowId}. The
  // ciphertext layer + DEK wiring is a Layer 1 dep — for now we attempt
  // a plaintext insert that the migration will replace with an
  // encrypted column once the schema lands. If anything fails we log
  // and swallow so the streaming response is not blocked.
  try {
    await withUser(args.userId, async (tx) => {
      const probe = (await tx.execute(
        sql`SELECT COUNT(*)::text AS exists_count
            FROM information_schema.tables
            WHERE table_name = 'ai_messages'`,
      )) as unknown as ProbeRow[];
      if (Number(probe[0]?.exists_count ?? "0") === 0) return;
      await tx.execute(
        sql`INSERT INTO ai_messages
              (conversation_id, role, content_plaintext, created_at)
            VALUES
              (${args.conversationId}, ${args.role}, ${args.text}, NOW())`,
      );
    });
  } catch (err) {
    log.warn({ err, role: args.role }, "ai.persist.skipped");
  }
}

export async function POST(request: Request): Promise<Response> {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isAiGatewayEnabled()) {
    return Response.json(
      { error: "ai_gateway_disabled" },
      { status: 503 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages)
    ? (body.messages as UIMessage[])
    : null;
  if (!messages || messages.length === 0) {
    return Response.json({ error: "missing_messages" }, { status: 400 });
  }
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  const locale =
    typeof body.locale === "string" && body.locale.length > 0
      ? body.locale
      : "he-IL";

  // Quota check — soft-warn / hard-block strategy per the route doc.
  const quotaMax = await getMonthlyMessageQuota(user.appUserId);
  if (quotaMax !== null && quotaMax !== -1) {
    const used = await countMessagesThisMonth(user.appUserId);
    if (quotaMax === 0 || used >= quotaMax) {
      return Response.json(
        { error: "quota_exceeded", quotaMax, used },
        { status: 402 },
      );
    }
    if (used >= Math.floor(quotaMax * 0.8)) {
      log.info(
        { userId: user.appUserId, used, quotaMax },
        "ai.quota.soft_warn",
      );
    }
  }

  // Pull the snapshot the user's question runs against. Prepended as a
  // system-role message so the model has the snapshot AS context and
  // never needs a tool round-trip for the basic numbers.
  const snapshot = await generateSnapshotContext(user.appUserId);

  // Persist the latest user turn best-effort. Failure is non-fatal.
  const latest = messages[messages.length - 1];
  if (latest && latest.role === "user") {
    const text = latest.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    await persistMessageBestEffort({
      userId: user.appUserId,
      conversationId,
      role: "user",
      text,
    });
  }

  const model = requireDefaultModel();
  const tools = buildAdvisorTools({ userId: user.appUserId });
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model,
    system: `${IL_TAX_ADVISOR_SYSTEM_PROMPT}\n\nUser snapshot context:\n${snapshot.text}`,
    messages: modelMessages,
    tools,
    onError({ error }) {
      log.error({ err: error }, "ai.stream.error");
    },
    async onFinish({ text }) {
      // ALWAYS run the disclaimer post-processor. `ensureDisclaimer` is
      // idempotent — if the model already produced the suffix the
      // helper does not duplicate it.
      const safeText = ensureDisclaimer(text, locale);
      await persistMessageBestEffort({
        userId: user.appUserId,
        conversationId,
        role: "assistant",
        text: safeText,
      });
    },
  });

  return result.toUIMessageStreamResponse({
    // The disclaimer suffix is appended by `onFinish` for persistence
    // but the streaming response itself flows raw model bytes. The
    // client-side `<AiChatPanel />` calls `ensureDisclaimer` on the
    // final assembled message before commit so the rendered text
    // always carries the required notice.
  });
}
