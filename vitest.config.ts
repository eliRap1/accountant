import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vitest config — Node environment by default. Component tests can opt
// into jsdom per-file via `/** @vitest-environment jsdom */`. E2E specs
// in tests/e2e/** are owned by Playwright and excluded here.
//
// Path alias `@/* -> ./*` mirrors tsconfig.json so test imports resolve
// to the same source modules the app uses. Env loading happens in
// tests/setup.ts via process.loadEnvFile so we do not need dotenv.
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules/**",
      "tests/e2e/**",
      ".next/**",
      "dist/**",
    ],
    setupFiles: ["./tests/setup.ts"],
    // Integration tests touch a live Neon dev branch; run them serially
    // so seed/cleanup blocks of one file do not race the next. Vitest 4
    // removed poolOptions; the equivalent is `fileParallelism: false`
    // + `maxWorkers: 1` on the `forks` pool.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "db/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "tests/**",
        "**/node_modules/**",
        ".next/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
