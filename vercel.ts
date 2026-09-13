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
        {
          // Baseline CSP for a static marketing site with inline styles (Tailwind/Framer Motion)
          // and Google Fonts. Tighten 'unsafe-inline' style-src once CSS-in-JS is removed or
          // nonces are added via middleware.
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            // Next.js inlines bootstrap scripts; @react-three/drei loads HDR env maps from jsdelivr
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            // Framer Motion and Tailwind inject inline styles at runtime
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            // drei Environment preset fetches HDR from the drei CDN
            "img-src 'self' data: blob:",
            "connect-src 'self'",
            "media-src 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'self'",
            "upgrade-insecure-requests",
          ].join("; "),
        },
      ],
    },
  ],
};

export default config;
