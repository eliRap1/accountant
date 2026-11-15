import EstimatesDisclaimer from "./EstimatesDisclaimer";

// Thin server-component wrapper for `<EstimatesDisclaimer />`. Use this
// from server components (e.g. `app/[locale]/(app)/layout.tsx`,
// route-level layouts, or PDF render shells) that need to embed the
// banner without flipping the parent into a client boundary.
//
// `<EstimatesDisclaimer>` itself is a client component because it
// calls `useTranslations()`. Wrapping it in a server shell lets a
// server tree compose it while keeping the rest of the surface
// server-rendered (and thus statically optimisable). next-intl's
// client provider is mounted in `app/[locale]/layout.tsx`, so the
// useTranslations call will resolve at hydration time.

export type EstimatesDisclaimerBannerProps = {
  className?: string;
};

export default function EstimatesDisclaimerBanner({
  className,
}: EstimatesDisclaimerBannerProps) {
  return (
    <EstimatesDisclaimer
      variant="banner"
      {...(className !== undefined ? { className } : {})}
    />
  );
}
