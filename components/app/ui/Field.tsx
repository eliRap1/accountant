"use client";

import { useId, type ReactNode } from "react";

// Shared form field primitive for the (app) CRUD surfaces. Matches the
// auth-form styling exactly: glass-strong panel, slate-950 input bg,
// emerald focus ring, dir-aware. Use `dir="ltr"` for numbers / emails /
// VAT IDs; Hebrew labels stay LTR-neutral (the parent <html dir> flips).
export type FieldProps = {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  dir?: "ltr" | "rtl";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  inputMode?:
    | "text"
    | "email"
    | "tel"
    | "url"
    | "numeric"
    | "decimal"
    | "search";
  min?: number | string;
  max?: number | string;
  step?: number | string;
  pattern?: string;
  help?: string;
};

export function Field(props: FieldProps): ReactNode {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="block text-sm text-slate-300">{props.label}</span>
      <input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete ?? "off"}
        dir={props.dir ?? "auto"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? ""}
        required={props.required ?? false}
        disabled={props.disabled ?? false}
        inputMode={props.inputMode ?? "text"}
        {...(props.min !== undefined ? { min: props.min } : {})}
        {...(props.max !== undefined ? { max: props.max } : {})}
        {...(props.step !== undefined ? { step: props.step } : {})}
        {...(props.pattern !== undefined ? { pattern: props.pattern } : {})}
        className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
      />
      {props.help && (
        <span className="mt-1 block text-[11px] text-slate-500">
          {props.help}
        </span>
      )}
    </label>
  );
}

export type SelectOption = { value: string; label: string };

export type SelectFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<SelectOption>;
  required?: boolean;
  disabled?: boolean;
  help?: string;
};

export function SelectField(props: SelectFieldProps): ReactNode {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="block text-sm text-slate-300">{props.label}</span>
      <select
        id={id}
        name={props.name}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required={props.required ?? false}
        disabled={props.disabled ?? false}
        className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value} className="bg-slate-950">
            {o.label}
          </option>
        ))}
      </select>
      {props.help && (
        <span className="mt-1 block text-[11px] text-slate-500">
          {props.help}
        </span>
      )}
    </label>
  );
}

export type TextareaFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  dir?: "ltr" | "rtl";
};

export function TextareaField(props: TextareaFieldProps): ReactNode {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="block text-sm text-slate-300">{props.label}</span>
      <textarea
        id={id}
        name={props.name}
        rows={props.rows ?? 3}
        dir={props.dir ?? "auto"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? ""}
        required={props.required ?? false}
        disabled={props.disabled ?? false}
        className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
      />
    </label>
  );
}

export function ErrorBanner({ message }: { message: string | null }): ReactNode {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      {message}
    </div>
  );
}
