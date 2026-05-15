// Server-side PostHog client (singleton). Used from route handlers,
// server actions, and the auth post-processing pipeline.
//
// Behavior:
//   - When NEXT_PUBLIC_POSTHOG_KEY is unset, return no-op stubs so dev
//     and CI can run without a PostHog project. Callers do not need to
//     null-check.
//   - flushAt: 1 + flushInterval: 0 means events ship immediately. This
//     matters for short-lived serverless functions where the process
//     exits before a queued event flushes. We still expose `flush()` so
//     callers can `await` it explicitly before returning if needed.
//
// The PostHog SDK exposes `_shutdown()` as the "wait for in-flight
// events, then drain" method, but we only re-export `flush()` because
// in our usage profile (per-request capture, flushAt: 1) it is enough.

import { PostHog } from "posthog-node";
import { env } from "@/lib/env";

type EventProps = Record<string, unknown>;

type CaptureOpts = {
  groups?: Record<string, string | number>;
  timestamp?: Date;
};

type ServerPostHog = {
  capture: (event: string, props?: EventProps, opts?: CaptureOpts) => void;
  identify: (distinctId: string, props?: EventProps) => void;
  flush: () => Promise<void>;
};

const NOOP: ServerPostHog = {
  capture: () => {},
  identify: () => {},
  flush: async () => {},
};

let cached: ServerPostHog | null = null;

function build(): ServerPostHog {
  const e = env();
  const key = e.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    return NOOP;
  }

  const client = new PostHog(key, {
    host: e.NEXT_PUBLIC_POSTHOG_HOST,
    // Serverless-friendly: flush every event right away so the function
    // doesn't terminate with queued payloads.
    flushAt: 1,
    flushInterval: 0,
  });

  return {
    capture: (event, props, opts) => {
      // PostHog requires a distinctId on every event. Anonymous server
      // events use a stable bucket-id so they aggregate sensibly in the
      // UI rather than landing under random IDs.
      const distinctId =
        (props && typeof props["distinctId"] === "string"
          ? (props["distinctId"] as string)
          : undefined) ?? "server";
      // Strip distinctId from properties so it isn't double-sent.
      const properties: EventProps = { ...(props ?? {}) };
      delete properties["distinctId"];

      client.capture({
        distinctId,
        event,
        properties,
        ...(opts?.groups ? { groups: opts.groups } : {}),
        ...(opts?.timestamp ? { timestamp: opts.timestamp } : {}),
      });
    },
    identify: (distinctId, props) => {
      client.identify({
        distinctId,
        ...(props ? { properties: props } : {}),
      });
    },
    flush: () => client.flush(),
  };
}

function getClient(): ServerPostHog {
  if (cached === null) {
    cached = build();
  }
  return cached;
}

export function capture(
  event: string,
  props?: EventProps,
  opts?: CaptureOpts,
): void {
  getClient().capture(event, props, opts);
}

export function identify(distinctId: string, props?: EventProps): void {
  getClient().identify(distinctId, props);
}

export function flush(): Promise<void> {
  return getClient().flush();
}
