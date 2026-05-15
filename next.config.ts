import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ["pino", "pino-pretty"],
};

export default withNextIntl(nextConfig);
