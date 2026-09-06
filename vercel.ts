// TODO(audit): Verify whether @vercel/config/v1 is actually consumed by the
// Vercel build pipeline for this project.  Standard Vercel configuration lives
// in vercel.json, and Next.js response headers are set via next.config.ts
// `headers()`.  If this file is not auto-loaded by the CLI, the security
// headers below (X-Frame-Options, HSTS, etc.) and the cache-control rules are
// never sent to clients.  Resolution: either confirm @vercel/config v1 wires
// this file automatically, or mirror the header rules into next.config.ts
// headers() so they are guaranteed to be applied.
import { routes, type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "next build",
  installCommand: "npm install",
  outputDirectory: ".next",

  headers: [
    routes.cacheControl("/_next/static/(.*)", {
      public: true,
      maxAge: "1 year",
      immutable: true,
    }),
    routes.cacheControl("/(.*\\.(?:woff2|woff|ttf|otf|eot))", {
      public: true,
      maxAge: "1 year",
      immutable: true,
    }),
    routes.cacheControl("/(.*\\.(?:png|jpg|jpeg|webp|avif|svg|ico|gif))", {
      public: true,
      maxAge: "30 days",
    }),
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ],
    },
  ],
};

export default config;
