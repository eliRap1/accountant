import { describe, it, expect } from "vitest";
import { pickTemplate, fillText } from "@/lib/email/dispatch";
import HeVerify from "@/lib/email/templates/he-IL/verify-email";
import HeReset from "@/lib/email/templates/he-IL/reset-password";
import EnVerify from "@/lib/email/templates/en-US/verify-email";
import EnReset from "@/lib/email/templates/en-US/reset-password";

// Hebrew block: U+0590–U+05FF.
function hasHebrew(s: string): boolean {
  return /[֐-׿]/.test(s);
}

describe("pickTemplate", () => {
  it("returns the HE verifyEmail template for he-IL", () => {
    const tpl = pickTemplate("he-IL", "verifyEmail");
    expect(tpl).toBe(HeVerify);
    expect(hasHebrew(tpl.text)).toBe(true);
  });

  it("returns the EN resetPassword template for en-US", () => {
    const tpl = pickTemplate("en-US", "resetPassword");
    expect(tpl).toBe(EnReset);
    expect(hasHebrew(tpl.text)).toBe(false);
  });

  it("returns the EN verifyEmail template for ru-RU (Plan v4 Risk #24)", () => {
    // Russian falls through to en-US because transactional copy has not
    // been CPA-reviewed in Russian. See lib/email/dispatch.ts.
    const tpl = pickTemplate("ru-RU", "verifyEmail");
    expect(tpl).toBe(EnVerify);
    expect(tpl).not.toBe(HeVerify);
  });

  it("returns the EN resetPassword template for ru-RU (fallback)", () => {
    const tpl = pickTemplate("ru-RU", "resetPassword");
    expect(tpl).toBe(EnReset);
    expect(tpl).not.toBe(HeReset);
  });
});

describe("fillText", () => {
  it("substitutes {url} once", () => {
    expect(fillText("click {url} now", { url: "https://example.test" })).toBe(
      "click https://example.test now",
    );
  });

  it("substitutes every occurrence of {url}", () => {
    expect(
      fillText("a {url} b {url} c", { url: "X" }),
    ).toBe("a X b X c");
  });

  it("substitutes {ip} and {ua}", () => {
    expect(
      fillText("from {ip} via {ua}", {
        ip: "10.0.0.1",
        ua: "curl/8",
      }),
    ).toBe("from 10.0.0.1 via curl/8");
  });

  it("emits an em-dash when ip/ua are null", () => {
    expect(fillText("from {ip} via {ua}", { ip: null, ua: null })).toBe(
      "from — via —",
    );
  });

  it("leaves unknown markers in place (loud failure mode)", () => {
    // Documented behaviour: unknown markers stay so QA notices.
    expect(fillText("see {totp}", { url: "x" })).toBe("see {totp}");
  });

  it("returns empty for {url} when url is undefined", () => {
    expect(fillText("link: {url}", {})).toBe("link: ");
  });
});
