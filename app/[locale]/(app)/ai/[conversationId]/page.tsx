import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import { sql } from "drizzle-orm";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import { routing } from "@/i18n/routing";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { isAiGatewayEnabled } from "@/lib/ai/gateway";
import { generateSnapshotContext } from "@/lib/ai/snapshot";
import { decryptStringWithDek } from "@/lib/security/encryption";
import AiChatPanel from "../AiChatPanel";
import type { UIMessage } from "ai";

// Single conversation surface. Renders the panel pre-loaded with the
// stored messages so the user picks up where they left off.
//
// Layer 1 dep: `ai_conversations` + `ai_messages`. When either is
// missing the page falls back to "thread not found" + a CTA to start
// a new conversation.
//
// Decryption: messages may live in `content_ciphertext` with a
// `dek_id` ref + AAD bound to {table:'ai_messages',
// column:'content_ciphertext', rowId}. The legacy `content_plaintext`
// column is honoured for mid-migration safety.
//
// Disclaimer literal (matched by HE_DISCLAIMER in lint-legal-text.ts):
// אומדנים בלבד · אינו ייעוץ מס

type ProbeRow = { exists_count: string };
type MsgRow = {
  id: string;
  role: string;
  content_plaintext: string | null;
  content_ciphertext: string | null;
  dek_id: string | null;
  created_at: string;
};

function isCiphertext(value: string): boolean {
  return /^v1:/.test(value);
}

async function loadConversation(userId: string, conversationId: string): Promise<{
  found: boolean;
  rows: MsgRow[];
}> {
  try {
    return await withUser(userId, async (tx) => {
      const probe = (await tx.execute(
        sql`SELECT COUNT(*)::text AS exists_count
            FROM information_schema.tables
            WHERE table_name = 'ai_messages'`,
      )) as unknown as ProbeRow[];
      if (Number(probe[0]?.exists_count ?? "0") === 0) {
        return { found: false, rows: [] as MsgRow[] };
      }
      const rows = (await tx.execute(
        sql`SELECT id::text, role::text,
                   content_plaintext, content_ciphertext, dek_id,
                   created_at::text
            FROM ai_messages
            WHERE conversation_id = ${conversationId}
            ORDER BY created_at ASC
            LIMIT 200`,
      )) as unknown as MsgRow[];
      return { found: true, rows };
    });
  } catch {
    return { found: false, rows: [] };
  }
}

export const metadata = {
  title: "AI Conversation · AccounTech",
};

export default async function AiConversationPage({
  params,
}: {
  params: Promise<{ locale: string; conversationId: string }>;
}) {
  const { locale, conversationId } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);

  const user = await requireCurrentUser();
  const t = await getTranslations("app.ai");
  const enabled = isAiGatewayEnabled();
  const conversation = await loadConversation(user.appUserId, conversationId);
  const snapshot = await generateSnapshotContext(user.appUserId);

  // Materialise stored messages → AI SDK v6 UIMessage shape.
  const initialMessages: UIMessage[] = [];
  for (const row of conversation.rows) {
    let text = row.content_plaintext ?? "";
    if (
      row.content_ciphertext &&
      isCiphertext(row.content_ciphertext) &&
      row.dek_id
    ) {
      try {
        text = await decryptStringWithDek({
          ciphertext: row.content_ciphertext,
          dekId: row.dek_id,
          aad: {
            table: "ai_messages",
            column: "content_ciphertext",
            rowId: row.id,
          },
        });
      } catch {
        text = "";
      }
    }
    initialMessages.push({
      id: row.id,
      role: row.role === "user" ? "user" : "assistant",
      parts: [{ type: "text", text }],
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <EstimatesDisclaimerBanner />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {t("conversation.title")}
        </h1>
        <p className="text-sm text-slate-400">
          {t("conversation.subtitle", { id: conversationId.slice(0, 8) })}
        </p>
      </header>

      {!enabled ? (
        <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-6 text-sm text-amber-100">
          <h2 className="text-base font-medium">{t("disabled.title")}</h2>
          <p className="mt-1 text-amber-200/90">{t("disabled.desc")}</p>
        </section>
      ) : !conversation.found ? (
        <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-6 text-sm text-amber-100">
          <h2 className="text-base font-medium">
            {t("conversation.notFoundTitle")}
          </h2>
          <p className="mt-1 text-amber-200/90">
            {t("conversation.notFoundDesc")}
          </p>
        </section>
      ) : (
        <AiChatPanel
          initialMessages={initialMessages}
          conversationId={conversationId}
          snapshotPreview={snapshot.text}
        />
      )}
    </div>
  );
}
