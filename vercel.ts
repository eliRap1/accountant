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
        // TODO(audit): add Content-Security-Policy header once inline-style / canvas requirements are mapped
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
