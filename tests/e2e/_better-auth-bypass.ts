import type { APIRequestContext, BrowserContext } from "@playwright/test";

// E2E sign-in bypass. Plan v4 §Auth — Test bypass.
//
// Instead of typing the password + clicking Submit on every test that
// needs an authenticated user, we drive Better Auth's HTTP API directly
// against the same Next.js server Playwright already booted. The
// resulting Set-Cookie headers are stuffed into the BrowserContext so
// subsequent page.goto calls are already signed in.
//
// This file is intentionally NOT a `.spec.ts` — Playwright would treat
// it as a test otherwise. Tests import the helper instead.

export type SignInOptions = {
  email: string;
  password: string;
  baseURL?: string;
};

export type SignInResult = {
  /** Raw Set-Cookie header values returned by Better Auth. */
  setCookieHeaders: string[];
};

/**
 * Sign in via Better Auth's HTTP API. Throws on non-2xx so tests fail
 * fast at the bypass step rather than further down.
 */
export async function signInViaApi(
  request: APIRequestContext,
  opts: SignInOptions,
): Promise<SignInResult> {
  const baseURL = opts.baseURL ?? "";
  const response = await request.post(`${baseURL}/api/auth/sign-in/email`, {
    data: {
      email: opts.email,
      password: opts.password,
      rememberMe: true,
    },
    headers: { "content-type": "application/json" },
    failOnStatusCode: true,
  });
  // Playwright merges all Set-Cookie values into a comma-joined string.
  // We split on the cookie boundary using a heuristic that does not eat
  // commas inside cookie attributes.
  const raw = response.headers()["set-cookie"] ?? "";
  const headers = raw
    .split(/\n|, (?=[A-Za-z0-9_.-]+=)/)
    .filter((s) => s.trim().length > 0);
  return { setCookieHeaders: headers };
}

/**
 * Convert raw Set-Cookie strings into the cookie-shape Playwright
 * accepts on context.addCookies(). Domain defaults to "localhost" so
 * the cookies survive a same-origin navigation in the test browser.
 */
export function setCookieToPlaywright(
  setCookies: string[],
  origin: string,
): Parameters<BrowserContext["addCookies"]>[0] {
  const url = new URL(origin);
  return setCookies.map((header) => {
    // Split into name=value plus attribute pairs.
    const [pair, ...attrs] = header.split(/;\s*/);
    const eq = (pair ?? "").indexOf("=");
    const name = (pair ?? "").slice(0, eq);
    const value = (pair ?? "").slice(eq + 1);

    let path = "/";
    let httpOnly = false;
    let secure = false;
    let sameSite: "Lax" | "Strict" | "None" = "Lax";
    let expires: number | undefined;
    for (const attr of attrs) {
      const [k, v] = attr.split("=");
      switch ((k ?? "").toLowerCase()) {
        case "path":
          path = v ?? "/";
          break;
        case "httponly":
          httpOnly = true;
          break;
        case "secure":
          secure = true;
          break;
        case "samesite":
          sameSite = ((v ?? "Lax") as typeof sameSite) ?? "Lax";
          break;
        case "expires":
          expires = v ? Math.floor(new Date(v).getTime() / 1000) : undefined;
          break;
        default:
          break;
      }
    }

    return {
      name,
      value,
      domain: url.hostname,
      path,
      httpOnly,
      secure,
      sameSite,
      ...(expires !== undefined ? { expires } : {}),
    };
  });
}

/**
 * One-shot helper: sign in, attach cookies to the browser context.
 */
export async function authenticateContext(
  context: BrowserContext,
  request: APIRequestContext,
  opts: SignInOptions & { origin: string },
): Promise<void> {
  const { setCookieHeaders } = await signInViaApi(request, opts);
  const cookies = setCookieToPlaywright(setCookieHeaders, opts.origin);
  await context.addCookies(cookies);
}
