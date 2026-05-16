import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import { sql } from "drizzle-orm";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { isAiGatewayEnabled } from "@/lib/ai/gateway";
import { generateSnapshotContext } from "@/lib/ai/snapshot";
import AiChatPanel from "./AiChatPanel";

// AI Tax Advisor entry surface.
//
// Two render branches:
//   1. Gateway disabled (AI_GATEWAY_API_KEY missing) → render an
//      "advisor unavailable" empty state. No call to OpenAI.
//   2. Gateway enabled → render the chat panel + the conversation
//      sidebar (Layer 1 dep: `ai_conversations`).
//
// Disclaimer literal (matched by HE_DISCLAIMER in lint-legal-text.ts):
// אומדנים בלבד · אינו ייעוץ מס

export const metadata = {
  title: "AI Advisor · AccounTech",
};

type ConvRow = {
  id: string;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
};
type ProbeRow = { exists_count: string };

async function listConversations(userId: string): Promise<ConvRow[]> {
  try {
    return await withUser(userId, async (tx) => {
      const probe = (await tx.execute(
        sql`SELECT COUNT(*)::text AS exists_count
            FROM information_schema.tables
            WHERE table_name = 'ai_conversations'`,
      )) as unknown as ProbeRow[];
      if (Number(probe[0]?.exists_count ?? "0") === 0) return [];
      return (await tx.execute(
        sql`SELECT id::text, title, created_at::text, last_message_at::text
            FROM ai_conversations
            ORDER BY COALESCE(last_message_at, created_at) DESC
            LIMIT 20`,
      )) as unknown as ConvRow[];
    });
  } catch {
    return [];
  }
}

export default async function AiPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);

  const user = await requireCurrentUser();
  const t = await getTranslations("app.ai");
  const conversations = await listConversations(user.appUserId);
  const snapshot = await generateSnapshotContext(user.appUserId);
  const enabled = isAiGatewayEnabled();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <EstimatesDisclaimerBanner />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {t("title")}
        </h1>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <aside
          className="rounded-2xl border border-white/5 bg-slate-950/40 p-3"
          aria-label={t("historyLabel")}
        >
          <p className="px-2 py-1 text-xs uppercase tracking-[0.16em] text-slate-500">
            {t("historyLabel")}
          </p>
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-slate-400">
              {t("historyEmpty")}
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/ai/${c.id}` as Route}
                    className="flex flex-col gap-0.5 rounded-lg px-2 py-2 text-sm text-slate-200 transition-colors hover:bg-white/5"
                  >
                    <span className="truncate font-medium">
                      {c.title ?? t("untitledThread")}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {new Date(
                        c.last_message_at ?? c.created_at,
                      ).toLocaleDateString(locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main>
          {!enabled ? (
            <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-6 text-sm text-amber-100">
              <h2 className="text-base font-medium">{t("disabled.title")}</h2>
              <p className="mt-1 text-amber-200/90">{t("disabled.desc")}</p>
            </section>
          ) : (
            <AiChatPanel
              initialMessages={[]}
              conversationId={null}
              snapshotPreview={snapshot.text}
            />
          )}
        </main>
      </div>
    </div>
  );
}
