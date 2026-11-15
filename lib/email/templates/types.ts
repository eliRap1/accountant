import type { AppLocale } from "@/i18n/routing";

// Shared prop shape every template accepts. Individual templates pick the
// fields they need; we keep the surface uniform so the dispatch map can
// hand callers a stable signature regardless of locale.
export type EmailTemplateProps = {
  user: { email: string; name?: string | null };
  /** Verification link, password-reset link, or sign-in link. */
  url?: string;
  /** Best-effort client IP from the request that triggered the email. */
  ip?: string | null;
  /** Best-effort user-agent string from the request. */
  ua?: string | null;
  /**
   * Locale of the email body. NOT necessarily the user's stored locale —
   * sometimes we infer from request headers before the row exists.
   */
  locale: AppLocale;
};

// Subject + plain-text fallback are returned alongside the template so the
// caller has everything it needs in one import.
export type EmailTemplate = {
  subject: string;
  text: string;
  Component: (props: EmailTemplateProps) => React.ReactElement;
};
