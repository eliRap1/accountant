"use client";

import { useEffect, useState, type FormEvent } from "react";
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
        setError(result.error.message ?? "שגיאה בטעינת מפתחות");
        return;
      }
      setList((result.data ?? []) as Passkey[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
    }
  }

  useEffect(() => {
    refresh();
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
        setError(result.error.message ?? "רישום נכשל");
        return;
      }
      setSuccess("המפתח נרשם");
      setNewName("");
      setAdding(false);
      await refresh();
      window.setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("למחוק את המפתח? לא ניתן לבטל.")) return;
    setError(null);
    try {
      const result = await passkey.deletePasskey({ id });
      if (result?.error) {
        setError(result.error.message ?? "מחיקה נכשלה");
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
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
            מפתחות גישה
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            כניסה עם Face ID / Touch ID / Windows Hello — בלי סיסמה.
          </p>
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
            אין עדיין מפתחות גישה. הוסיפו אחד למטה.
          </p>
        )}
        {list?.map((pk) => (
          <div
            key={pk.id}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/40 px-4 py-3"
          >
            <div>
              <p className="text-sm text-slate-100">
                {pk.name || "מפתח ללא שם"}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatDeviceType(pk.deviceType)}
                {pk.createdAt && ` · נוסף ${formatDate(pk.createdAt)}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onDelete(pk.id)}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
              aria-label="מחיקה"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <form onSubmit={onAdd} className="mt-6 space-y-4">
          <label className="block">
            <span className="block text-sm text-slate-300">
              שם למפתח (למשל: "iPhone של אלי")
            </span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
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
              {submitting ? "ממתין למכשיר..." : "המשך"}
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
              ביטול
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
          הוספת מפתח גישה
        </button>
      )}
    </motion.section>
  );
}

function formatDeviceType(t: string | null | undefined): string {
  switch (t) {
    case "singleDevice":
      return "מכשיר יחיד";
    case "multiDevice":
      return "מסונכרן בענן (Apple / Google / Microsoft)";
    default:
      return t ?? "מפתח חומרה";
  }
}

function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
