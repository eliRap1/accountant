"use client";

// Client-side PostHog provider. Inits posthog-js inside useEffect so
// the SDK only loads on the browser (Next.js bundles `"use client"`
// modules into the client chunk; the useEffect gate also keeps init out
// of SSR hydration).
//
// Why a custom wrapper and not `posthog-js/react`'s PostHogProvider
// directly?
//   - We want the init *side effects* tied to a useEffect with an
//     env-key gate, so a missing key cleanly degrades into a no-op
//     instead of throwing in init.
//   - We want a single audit point for our config (history-change
//     pageviews, no session recording, dev opt-out).
//
// `usePostHog` is re-exported so consumers don't need a second import.

import { useEffect, useState } from "react";
import type { PostHog } from "posthog-js";
import posthog from "posthog-js";
import {
  PostHogProvider as PHReactProvider,
  usePostHog as usePostHogHook,
} from "posthog-js/react";

type Props = {
  children: React.ReactNode;
  /** Public API key (`NEXT_PUBLIC_POSTHOG_KEY`). When absent, render-only. */
  apiKey?: string;
  /** EU host (`NEXT_PUBLIC_POSTHOG_HOST`). Defaults to PostHog Cloud EU. */
  apiHost: string;
};

export function PostHogProvider({ children, apiKey, apiHost }: Props) {
  const [client, setClient] = useState<PostHog | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    // Initialise once per page lifetime. posthog-js is internally
    // idempotent on `init`, but we still gate to avoid spurious
    // diagnostic warnings.
    if (posthog.__loaded) {
      setClient(posthog);
      return;
    }

    posthog.init(apiKey, {
      api_host: apiHost,
      // Capture pageviews via Next.js's client-side router (history API
      // changes) rather than full reloads.
      capture_pageview: "history_change",
      // Session recording is opt-in only — disabled until a real
      // privacy review approves it.
      disable_session_recording: true,
      loaded: (ph) => {
        if (process.env.NODE_ENV === "development") {
          ph.opt_out_capturing();
        }
      },
    });
    setClient(posthog);
  }, [apiKey, apiHost]);

  // Without a client (missing key, or pre-init render) just pass
  // children through. We deliberately avoid rendering the react SDK's
  // provider with a placeholder client because its type signature
  // requires a real PostHog instance.
  if (!client) {
    return <>{children}</>;
  }

  return <PHReactProvider client={client}>{children}</PHReactProvider>;
}

export const usePostHog = usePostHogHook;
