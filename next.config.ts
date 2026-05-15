import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ["pino", "pino-pretty"],
};

// Wrap with next-intl first (it injects the request-config alias) and
// then with Sentry so source-map upload and instrumentation see the
// already-resolved config object.
const withIntlConfig = withNextIntl(nextConfig);

// Source-map upload only happens when both an org slug and an auth
// token are present. Without either, the Sentry build plugin emits no
// uploads (sourcemaps.disable: true) so dev / preview builds without
// secrets remain fast and avoid noisy warnings.
const sentryOrg = process.env["SENTRY_ORG"];
const sentryAuthToken = process.env["SENTRY_AUTH_TOKEN"];
const uploadSourceMaps = Boolean(sentryOrg && sentryAuthToken);

export default withSentryConfig(withIntlConfig, {
  // Placeholders — set real values via SENTRY_ORG / SENTRY_PROJECT env vars
  // or by replacing the strings below before going live.
  org: sentryOrg ?? "<placeholder>",
  project: process.env["SENTRY_PROJECT"] ?? "<placeholder>",
  silent: true,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
  // Avoid noisy "Sentry plugin uploaded a sourcemap…" lines for the
  // App Router transition warning.
  suppressOnRouterTransitionStartWarning: true,
  sourcemaps: uploadSourceMaps
    ? // Defaults: upload during build, then delete the .map files so
      // they aren't shipped to clients.
      {}
    : // No auth token -> disable upload entirely. The plugin still
      // injects debug IDs into bundles so future builds with secrets
      // remain compatible, but nothing leaves the local process.
      { disable: true },
});
