"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { SelectField, ErrorBanner } from "@/components/app/ui/Field";
import FilingKindPicker, {
  type FilingKind,
} from "@/components/app/filings/FilingKindPicker";
import FilingPeriodPicker from "@/components/app/filings/FilingPeriodPicker";
import FilingPreviewCard from "@/components/app/filings/FilingPreviewCard";
import { buildFiling, previewPcn874 } from "../actions";

export type BusinessOption = {
  id: string;
  legalName: string;
  vatStatus: string;
  defaultCurrency: string;
};

export type WizardEntitlements = {
  canPcn: boolean;
  canForms: boolean;
};

type Props = {
  businesses: ReadonlyArray<BusinessOption>;
  entitlements: WizardEntitlements;
  showAcknowledgeCheckbox: boolean;
};

type Step = "kind" | "period" | "review" | "done";

const STEPS_ORDER: Step[] = ["kind", "period", "review"];

const FISCAL_YEAR_KINDS = new Set<FilingKind>([
  "form_6111",
  "form_1301",
  "form_1214",
  "form_126",
  "form_856",
]);

function defaultPeriodFor(kind: FilingKind | ""): {
  start: string;
  end: string;
} {
  const today = new Date();
  if (kind === "" || kind === "pcn874" || kind === "form_102") {
    // Default to the most recently completed month.
    const month = today.getUTCMonth(); // 0-indexed
    const year = today.getUTCFullYear();
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  // Annual forms default to the prior calendar year.
  const fy = today.getUTCFullYear() - 1;
  return { start: `${fy}-01-01`, end: `${fy}-12-31` };
}

export default function FilingWizard({
  businesses,
  entitlements,
  showAcknowledgeCheckbox,
}: Props): ReactNode {
  const t = useTranslations("app.filings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const [step, setStep] = useState<Step>("kind");
  const [kind, setKind] = useState<FilingKind | "">("");
  const [businessId, setBusinessId] = useState<string>(
    businesses[0]?.id ?? "",
  );
  const initial = defaultPeriodFor("");
  const [periodStart, setPeriodStart] = useState<string>(initial.start);
  const [periodEnd, setPeriodEnd] = useState<string>(initial.end);
  const [acknowledge, setAcknowledge] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    invoiceCount: number;
    sumPreVatMinor: string;
    sumVatMinor: string;
  } | null>(null);

  // Derive the locked-kinds set from entitlements.
  const lockedKinds: FilingKind[] = [];
  if (!entitlements.canPcn) lockedKinds.push("pcn874");
  if (!entitlements.canForms) {
    lockedKinds.push(
      "form_6111",
      "form_102",
      "form_1301",
      "form_1214",
      "form_126",
      "form_856",
    );
  }

  const stepIndex = STEPS_ORDER.indexOf(step);

  function handleSelectKind(next: FilingKind) {
    setKind(next);
    const period = defaultPeriodFor(next);
    setPeriodStart(period.start);
    setPeriodEnd(period.end);
    setPreview(null);
    setError(null);
  }

  function goBack() {
    setError(null);
    if (stepIndex > 0) {
      setStep(STEPS_ORDER[stepIndex - 1] ?? "kind");
    }
  }

  async function goForward() {
    setError(null);
    if (step === "kind") {
      // No-op if the operator hasn't picked a kind yet — the "Next"
      // button is already disabled in that state, so this branch only
      // fires defensively.
      if (kind === "") return;
      setStep("period");
      return;
    }
    if (step === "period") {
      if (!businessId) {
        setError(t("wizard.missingBusiness"));
        return;
      }
      if (!periodStart || !periodEnd) {
        setError(t("wizard.missingPeriod"));
        return;
      }
      // For PCN874 we can show a real preview by querying invoice
      // totals. For other forms there is no light-weight aggregate
      // exposed, so we move straight to the review step.
      if (kind === "pcn874") {
        setBusy(true);
        try {
          const result = await previewPcn874(businessId, periodStart, periodEnd);
          setPreview(result);
        } catch {
          setPreview(null);
        } finally {
          setBusy(false);
        }
      }
      setStep("review");
      return;
    }
    if (step === "review") {
      await onSubmit();
      return;
    }
  }

  async function onSubmit() {
    if (kind === "") return;
    if (showAcknowledgeCheckbox && !acknowledge) {
      setError(t("wizard.missingAcknowledge"));
      return;
    }
    const fd = new FormData();
    fd.set("businessId", businessId);
    fd.set("kind", kind);
    fd.set("periodStart", periodStart);
    fd.set("periodEnd", periodEnd);
    // Always submit acknowledgeSpecUnverified=true server-side IF the
    // checkbox was visible to the operator and they ticked it. When the
    // checkbox is hidden (regular users in production), this flag is
    // false and the generator's SpecNotVerified throw surfaces as the
    // localised error.
    if (showAcknowledgeCheckbox && acknowledge) {
      fd.set("acknowledgeSpecUnverified", "true");
    }
    setBusy(true);
    try {
      const result = await buildFiling(fd);
      if ("error" in result) {
        // Error keys are full dotted paths like "app.filings.errors.generic"
        // — strip the "app.filings." prefix to resolve through the current
        // namespace. Unknown keys fall back to the generic error.
        const key = result.error.replace(/^app\.filings\./, "");
        try {
          setError(t(key as never));
        } catch {
          setError(t("errors.generic"));
        }
        return;
      }
      const id = result.id;
      startTransition(() => {
        router.push(`/filings/${id}`);
      });
      setStep("done");
    } catch {
      setError(t("wizard.unknownError"));
    } finally {
      setBusy(false);
    }
  }

  const fiscalYear = FISCAL_YEAR_KINDS.has(kind as FilingKind)
    ? Number.parseInt(periodStart.slice(0, 4), 10)
    : undefined;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("wizard.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("disclaimer")}</p>
        </div>
        <ProgressIndicator step={step} t={t} />
      </header>

      <ErrorBanner message={error} />

      <AnimatePresence mode="wait">
        {step === "kind" ? (
          <motion.div
            key="step-kind"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-4"
          >
            <FilingKindPicker
              value={kind}
              onChange={handleSelectKind}
              lockedKinds={lockedKinds}
              disabled={busy || pending}
            />
          </motion.div>
        ) : null}

        {step === "period" ? (
          <motion.div
            key="step-period"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="glass-strong rounded-2xl p-5 space-y-4"
          >
            <SelectField
              label={t("wizard.businessLabel")}
              name="businessId"
              value={businessId}
              onChange={setBusinessId}
              options={businesses.map((b) => ({
                value: b.id,
                label: b.legalName,
              }))}
              help={t("wizard.businessHelp")}
              disabled={busy || pending}
            />
            {kind !== "" ? (
              <FilingPeriodPicker
                kind={kind}
                periodStart={periodStart}
                periodEnd={periodEnd}
                onChangeStart={setPeriodStart}
                onChangeEnd={setPeriodEnd}
                disabled={busy || pending}
              />
            ) : null}
          </motion.div>
        ) : null}

        {step === "review" ? (
          <motion.div
            key="step-review"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-4"
          >
            {kind !== "" ? (
              <FilingPreviewCard
                kind={kind}
                {...(preview
                  ? {
                      invoiceCount: preview.invoiceCount,
                      sumPreVatMinor: preview.sumPreVatMinor,
                      sumVatMinor: preview.sumVatMinor,
                    }
                  : {})}
                {...(fiscalYear !== undefined ? { fiscalYear } : {})}
              />
            ) : null}

            <section className="glass rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4">
              <h3 className="flex items-center gap-2 text-sm font-medium tracking-tight text-amber-100">
                <AlertTriangle size={14} className="text-amber-300" />
                {t("wizard.acknowledgeTitle")}
              </h3>
              <p className="mt-2 text-xs text-amber-100/80">
                {t("wizard.acknowledgeBody")}
              </p>
              {showAcknowledgeCheckbox ? (
                <label className="mt-3 flex items-center gap-2 text-xs text-amber-100">
                  <input
                    type="checkbox"
                    checked={acknowledge}
                    onChange={(e) => setAcknowledge(e.target.checked)}
                    className="h-4 w-4 rounded border border-amber-400/40 bg-slate-950/60 text-emerald-400 focus:ring-emerald-500/40"
                  />
                  <span>{t("wizard.acknowledgeCheckbox")}</span>
                </label>
              ) : null}
            </section>
          </motion.div>
        ) : null}

        {step === "done" ? (
          <motion.div
            key="step-done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="glass-strong rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-6"
          >
            <div className="flex items-center gap-3 text-emerald-100">
              <CheckCircle2 size={20} />
              <p className="text-sm">{t("readyForPortalUpload")}</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {step !== "done" ? (
        <div className="flex items-center justify-between gap-2">
          <div>
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={goBack}
                disabled={busy || pending}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-white/20 disabled:opacity-60"
              >
                <ChevronLeft size={14} />
                {t("wizard.back")}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={goForward}
            disabled={busy || pending || (step === "kind" && kind === "")}
            className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60"
          >
            {busy || pending
              ? t("wizard.submitting")
              : step === "review"
                ? t("wizard.submitGenerate")
                : t("wizard.next")}
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProgressIndicator({
  step,
  t,
}: {
  step: Step;
  t: (k: string) => string;
}) {
  const idx = STEPS_ORDER.indexOf(step);
  return (
    <div className="hidden gap-2 text-xs text-slate-500 sm:flex">
      {STEPS_ORDER.map((s, i) => {
        const active = i <= idx;
        return (
          <span
            key={s}
            className={
              active
                ? "flex items-center gap-1.5 text-emerald-200"
                : "flex items-center gap-1.5"
            }
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                active
                  ? "border-emerald-400/60 bg-emerald-500/20"
                  : "border-white/10 bg-slate-950/60"
              }`}
              dir="ltr"
            >
              {i + 1}
            </span>
            {t(
              s === "kind"
                ? "wizard.stepKind"
                : s === "period"
                  ? "wizard.stepPeriod"
                  : "wizard.stepReview",
            )}
          </span>
        );
      })}
    </div>
  );
}
