import { test, expect } from "@playwright/test";

// Phase A.7 smoke E2E. Runs on chromium + firefox via playwright.config.ts.
// The server must already be reachable at baseURL — `webServer` starts it
// when invoked locally without one running.

test.describe("smoke — public surfaces", () => {
  test("he-IL landing renders with AccounTech hero copy", async ({ page }) => {
    await page.goto("/he-IL");
    // Hero brand mention appears in metadata title; check body text too.
    await expect(page).toHaveTitle(/AccounTech/);
    await expect(page.locator("body")).toContainText(/AccounTech/i, {
      timeout: 15_000,
    });
  });

  test("en-US sign-in renders email + password fields and submit button", async ({ page }) => {
    await page.goto("/en-US/sign-in");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("he-IL sign-up renders form; Turnstile iframe present only when site key set", async ({
    page,
    request: _request,
  }) => {
    void _request;
    await page.goto("/he-IL/sign-up");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();

    // Whether Turnstile renders depends on the build-time NEXT_PUBLIC_
    // site key. Check if the container exists; if it does, the iframe
    // should follow once the Cloudflare script loads.
    const container = page.locator(".cf-turnstile-container");
    const count = await container.count();
    if (count > 0) {
      // Up to 10s for the Cloudflare script + widget render.
      await expect(page.locator(".cf-turnstile-container iframe")).toBeVisible({
        timeout: 10_000,
      });
    } else {
      test.info().annotations.push({
        type: "skip-reason",
        description: "NEXT_PUBLIC_TURNSTILE_SITE_KEY unset — Turnstile not rendered",
      });
    }
  });
});

test.describe("smoke — locale routing", () => {
  test("ru-RU/sign-in serves the en-US auth surface (rewrite, not redirect)", async ({
    page,
  }) => {
    // proxy.ts rewrites /ru-RU/sign-in → /en-US/sign-in internally. The
    // URL stays on /ru-RU/ but the body is the English form copy. The
    // SignInForm hard-codes Hebrew strings in its current implementation,
    // so we cannot assert on body language — we only assert that the
    // page renders and the email/password inputs are present.
    const response = await page.goto("/ru-RU/sign-in");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    // The URL should remain on /ru-RU/ after the rewrite per Plan v4.
    expect(page.url()).toContain("/ru-RU/");
  });

  test("ru-RU marketing landing stays on /ru-RU/ and renders", async ({ page }) => {
    const response = await page.goto("/ru-RU");
    expect(response?.status()).toBeLessThan(400);
    expect(page.url()).toContain("/ru-RU");
    await expect(page.locator("body")).toContainText(/AccounTech/i);
  });
});

test.describe("smoke — locale dir attribute", () => {
  test("he-IL renders html dir=rtl", async ({ page }) => {
    await page.goto("/he-IL/terms");
    const dir = await page.locator("html").getAttribute("dir");
    expect(dir).toBe("rtl");
  });

  test("en-US renders html dir=ltr", async ({ page }) => {
    await page.goto("/en-US/terms");
    const dir = await page.locator("html").getAttribute("dir");
    expect(dir).toBe("ltr");
  });
});
