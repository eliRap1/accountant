// Next.js 16 boot hook. Called once per server instance before the first
// request is served. We use it to gate startup on the auth/crypto/db
// integrity check — see lib/auth/selfTest.ts.
//
// Edge runtime is skipped because postgres-js + node:crypto rely on
// node:net / node:tls which Edge does not expose.
export async function register() {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  if (process.env["NODE_ENV"] === "test") return;

  const { runStartupSelfTest } = await import("@/lib/auth/selfTest");
  try {
    await runStartupSelfTest();
    console.info("[selfTest] passed");
  } catch (err) {
    console.error("[selfTest] FAILED — refusing to start:", err);
    // Re-throw so Next surfaces it as a startup error rather than a
    // silent half-broken server.
    throw err;
  }
}
