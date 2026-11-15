// STUB — waiting for Salt Edge vendor contract.
// TODO(salt-edge): When the contract lands, this page should poll the
// bank_connections row for status transitions. Salt Edge will POST to
// /api/webhooks/salt-edge once the user completes the OAuth consent
// flow, at which point this page should auto-refresh to show "Connected".

import { getTranslations } from "next-intl/server";
import { Landmark } from "lucide-react";

export default async function BankLinkConnectingPage() {
  const t = await getTranslations("app.bankLinks");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center justify-center gap-6 px-4 py-24">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
        <Landmark size={28} />
      </div>
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">
          {t("connecting.title")}
        </h1>
        <p className="text-sm text-slate-400">{t("connecting.subtitle")}</p>
      </div>
      {/* TODO(salt-edge): Replace static notice with a real-time status
          poller once the Salt Edge webhook is implemented. */}
      <div className="w-full rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4 text-center text-xs text-amber-200">
        {t("connecting.stubNotice")}
      </div>
    </div>
  );
}
