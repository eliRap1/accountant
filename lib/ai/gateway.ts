// AI client — wraps the Vercel AI Gateway exposed by `ai` SDK v6.
//
// Why the Gateway and not @ai-sdk/openai directly:
//   - Cost tracking + fallback live at the Gateway layer.
//   - Provider/model strings let us swap models without redeploying.
//   - Plan v4 § Locked Decisions explicitly chooses `"provider/model"`
//     strings, not provider-specific packages, so the escape hatch
//     (`gateway → direct OpenAI/Anthropic`) is a single-line change.
//
// API surface verified against the local node_modules copy of
// `@ai-sdk/gateway@3.0.115` + `ai@6.0.183` (2026-05-16):
//   - `createGateway({ apiKey, baseURL? }) => GatewayProvider`
//   - `gateway` is the default instance reading AI_GATEWAY_API_KEY.
//   - `generateText({ model: gateway('provider/model'), ... })`.
//
// Skip-mode: when `AI_GATEWAY_API_KEY` is unset the module exports
// stubs that throw a `GatewayDisabledError`. Routes catch this and
// fall back to a "AI advisor not configured" empty state.

import { gateway, createGateway, type LanguageModel } from "ai";
import { env } from "@/lib/env";

// `ai@6.x` re-exports `gateway` + `createGateway` from `@ai-sdk/gateway`.
// We type the returned provider via `ReturnType<typeof createGateway>`
// so app code doesn't take a direct dependency on the (transitive-only)
// gateway package.
type GatewayProvider = ReturnType<typeof createGateway>;

export class GatewayDisabledError extends Error {
  readonly code = "AI_GATEWAY_DISABLED";
  constructor() {
    super(
      "AI_GATEWAY_API_KEY is not set — the IL tax advisor is disabled in this environment.",
    );
    this.name = "GatewayDisabledError";
  }
}

/**
 * `true` only when `AI_GATEWAY_API_KEY` is set. Used by routes / Server
 * Components to render an "advisor unavailable" message instead of
 * raising.
 */
export function isAiGatewayEnabled(): boolean {
  return Boolean(env().AI_GATEWAY_API_KEY);
}

/**
 * Lazy singleton — instantiated on first use so missing-env doesn't
 * crash module load (env() warns in dev, throws in prod, which is the
 * existing contract from lib/env.ts).
 */
let cachedClient: GatewayProvider | null = null;

function getGatewayClient(): GatewayProvider {
  if (!isAiGatewayEnabled()) throw new GatewayDisabledError();
  if (!cachedClient) {
    const apiKey = env().AI_GATEWAY_API_KEY!;
    // `createGateway` is an alias for `createGatewayProvider` per the
    // SDK type exports. Either works; we use the friendlier name.
    cachedClient = createGateway({ apiKey });
  }
  return cachedClient;
}

/**
 * Resolve a `LanguageModel` handle for the given `provider/model`
 * string. Defaults to `env().AI_MODEL` (currently
 * `openai/gpt-5.4-mini`). Escalation flows pass an explicit second
 * arg (typically `env().AI_ESCALATION_MODEL`).
 *
 * Returns `undefined` when the Gateway is disabled — callers can use
 * this to early-return without try/catch'ing every call site.
 */
export function getDefaultModel(modelId?: string): LanguageModel | undefined {
  if (!isAiGatewayEnabled()) return undefined;
  const id = modelId ?? env().AI_MODEL;
  return getGatewayClient()(id);
}

/**
 * Throwing variant — for code paths that already know the Gateway is
 * enabled (e.g. inside an API route guarded by `isAiGatewayEnabled()`).
 */
export function requireDefaultModel(modelId?: string): LanguageModel {
  const m = getDefaultModel(modelId);
  if (!m) throw new GatewayDisabledError();
  return m;
}

// Re-export the default `gateway` provider instance for callers that
// already have an apiKey-bound session (e.g. inside Vercel where the
// env var is auto-injected and the default singleton works).
export { gateway };
