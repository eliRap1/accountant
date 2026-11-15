"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { X, Landmark } from "lucide-react";
import { connectBank } from "./actions";

// IL banks surfaced in the stub picker. When Salt Edge ships the list
// expands to the full catalogue (300+ FIs). For now we show the five
// major Israeli retail banks.
const BANKS = [
  { slug: "leumi", nameKey: "banks.leumi" as const },
  { slug: "hapoalim", nameKey: "banks.hapoalim" as const },
  { slug: "discount", nameKey: "banks.discount" as const },
  { slug: "mizrahi", nameKey: "banks.mizrahi" as const },
  { slug: "fibi", nameKey: "banks.fibi" as const },
];

export default function ConnectBankButton({
  businessId,
}: {
  businessId: string;
}) {
  const t = useTranslations("app.bankLinks");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onConnect(slug: string) {
    setError(null);
    setConnectingSlug(slug);
    startTransition(async () => {
      // Simulate ~1.5 s OAuth handshake (stub delay).
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      const result = await connectBank(businessId, slug);
      if ("error" in result) {
        setError(result.error);
        setConnectingSlug(null);
        return;
      }
      setOpen(false);
      // Redirect to the "connecting…" status page.
      router.push(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        `/bank-links/${result.connectionId}/connecting` as any,
      );
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
      >
        <Landmark size={14} />
        {t("connectCta")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="glass-strong w-full max-w-sm rounded-2xl p-6 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">
                {t("connectCta")}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {error && (
              <div className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}

            <ul className="space-y-2">
              {BANKS.map((bank) => {
                const isBusy = pending && connectingSlug === bank.slug;
                return (
                  <li key={bank.slug}>
                    <button
                      type="button"
                      onClick={() => onConnect(bank.slug)}
                      disabled={pending}
                      className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span>{t(bank.nameKey)}</span>
                      <span className="text-xs text-emerald-300">
                        {isBusy ? "..." : t("connectCta")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 text-[11px] text-slate-500">
              {/* TODO(salt-edge): Replace this disclaimer once the real OAuth
                  flow is wired. The actual redirect will go through Salt Edge
                  Connect Widget which handles consent / PSD2. */}
              {t("subtitle")}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
