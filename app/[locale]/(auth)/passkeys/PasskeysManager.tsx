"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Loader2, KeyRound, Plus, Trash2, Check } from "lucide-react";
import { passkey } from "@/lib/auth/client";

type Passkey = {
  id: string;
  name?: string | null;
  deviceType?: string | null;
  createdAt?: string | Date | null;
};

export default function PasskeysManager() {
  const t = useTranslations("auth.passkeys");
  const locale = useLocale();
  const [list, setList] = useState<Passkey[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const result = await passkey.listUserPasskeys();
      if (result.error) {
        setError(result.error.message ?? t("errors.loadFailed"));
        return;
      }
      setList((result.data ?? []) as Passkey[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unexpected"));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const trimmedName = newName.trim();
      const result = await passkey.addPasskey(
        trimmedName ? { name: trimmedName } : {},
      );
      if (result?.error) {
        setError(result.error.message ?? t("errors.addFailed"));
        return;
      }
      setSuccess(t("added"));
      setNewName("");
      setAdding(false);
      await refresh();
      window.setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unexpected"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    setError(null);
    try {
      const result = await passkey.deletePasskey({ id });
      if (result?.error) {
        setError(result.error.message ?? t("errors.deleteFailed"));
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unexpected"));
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="glass-strong rounded-2xl p-8 shadow-[0_30px_80px_-30px_rgba(16,185,129,0.35)]"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <KeyRound size={18} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
        >
          <Check size={16} />
          {success}
        </div>
      )}

      <div className="mt-8 space-y-2">
        {list === null && (
          <div className="flex items-center justify-center py-6 text-slate-500">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}
        {list?.length === 0 && (
          <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
            {t("emptyState")}
          </p>
        )}
        {list?.map((pk) => (
          <div
            key={pk.id}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/40 px-4 py-3"
          >
            <div>
              <p className="text-sm text-slate-100">
                {pk.name || t("unnamed")}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatDeviceType(pk.deviceType, t)}
                {pk.createdAt && ` · ${t("addedOn")} ${formatDate(pk.createdAt, locale)}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onDelete(pk.id)}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
              aria-label={t("deleteAria")}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <form onSubmit={onAdd} className="mt-6 space-y-4">
          <label className="block">
            <span className="block text-sm text-slate-300">{t("nameLabel")}</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("namePlaceholder")}
              autoFocus
              disabled={submitting}
              className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
            />
          </label>
          <div className="flex items-center gap-3">
            <motion.button
              type="submit"
              disabled={submitting}
              {...(submitting
                ? {}
                : {
                    whileHover: { scale: 1.02, y: -1 },
                    whileTap: { scale: 0.98 },
                  })}
              transition={{ type: "spring", stiffness: 380, damping: 22 }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? t("addSubmitting") : t("addSubmit")}
            </motion.button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewName("");
              }}
              disabled={submitting}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-60"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/5 px-5 py-3 text-sm font-medium tracking-tight text-emerald-200 transition-colors hover:bg-emerald-500/10"
        >
          <Plus size={16} />
          {t("addPasskey")}
        </button>
      )}
    </motion.section>
  );
}

function formatDeviceType(
  type: string | null | undefined,
  t: (key: string) => string,
): string {
  switch (type) {
    case "singleDevice":
      return t("deviceSingle");
    case "multiDevice":
      return t("deviceMulti");
    default:
      return type ?? t("deviceUnknown");
  }
}

function formatDate(d: string | Date, locale: string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
