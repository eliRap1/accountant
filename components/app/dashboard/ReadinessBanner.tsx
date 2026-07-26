import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getPendingReadinessChecks } from "@/lib/readiness/checks";

// Surfaces the outstanding owner-side gates (domain, Turnstile, Stripe,
// CPA, etc.) on the dashboard so it's obvious what still blocks live
// traffic. Disappears automatically once every check passes.

export default async function ReadinessBanner() {
  const pending = getPendingReadinessChecks();
  if (pending.length === 0) return null;

  const t = await getTranslations("app.dashboard.readiness");

  return (
    <aside
      role="note"
      className="flex flex-col gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle size={16} className="text-amber-300" />
        <span>{t("title", { count: pending.length })}</span>
      </div>
      <ul className="space-y-1 text-xs text-amber-200/90">
        {pending.map((c) => (
          <li key={c.id} className="flex gap-2">
            <span aria-hidden className="text-amber-300">•</span>
            <span>
              <strong className="text-amber-100">{c.label}.</strong>{" "}
              {c.reason}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-300/80">{t("hint")}</p>
    </aside>
  );
}
