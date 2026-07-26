import { test, expect } from "@playwright/test";

// Landing pixel-diff per locale. Plan v4 §Verification Plan #9 requires
// the baseline of `/` to stay within 0.5% pixel drift. The HeroScene
// canvas seeds animation randomness, so we mask it; everything outside
// is the comparison surface.
//
// First run with no baseline:
//   pnpm test:e2e -- --update-snapshots
// writes the file under tests/e2e/__screenshots__/.

const LOCALES = ["he-IL", "en-US", "ru-RU"] as const;

for (const locale of LOCALES) {
  test(`landing pixel-diff — ${locale}`, async ({ page }, testInfo) => {
    // Pin viewport so screenshot dimensions are stable across machines.
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`/${locale}`, { waitUntil: "load" });

    // Fonts must finish loading before the snapshot — otherwise FOUT or
    // a fallback metric leaks into the diff.
    await page.evaluate(async () => {
      // `document.fonts.ready` resolves once all CSS font-face loads in
      // the current document have settled. Add a small budget for late
      // font-display: swap repaints.
      await (
        document as Document & { fonts: { ready: Promise<unknown> } }
      ).fonts.ready;
    });
    await page.waitForTimeout(200);

    // The HeroScene three.js canvas has random rotation seeds. Mask it.
    const canvases = page.locator("canvas");
    const masks = (await canvases.count()) > 0 ? [canvases] : [];

    await expect(page).toHaveScreenshot(`landing-${locale}.png`, {
      fullPage: false,
      maxDiffPixels: 5000,
      threshold: 0.2,
      animations: "disabled",
      caret: "hide",
      mask: masks,
    });

    testInfo.attach(`landing-${locale}.html`, {
      body: await page.content(),
      contentType: "text/html",
    });
  });
}
