import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

// next-intl resolves messages per request. The `requestLocale` here is
// what the middleware matched against `[locale]`; if it's missing or
// invalid we fall back to the project default (he-IL).
//
// We import message catalogues statically so every locale ships in the
// same RSC chunk — keeps cold-start latency low on Vercel Fluid Compute.
// Once the catalogues grow past ~50KB each we'll switch to dynamic
// imports keyed off `locale`.
import heIL from "../locales/he-IL.json";
import enUS from "../locales/en-US.json";
import ruRU from "../locales/ru-RU.json";

const messagesByLocale = {
  "he-IL": heIL,
  "en-US": enUS,
  "ru-RU": ruRU,
} as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: messagesByLocale[locale],
    timeZone: "Asia/Jerusalem",
    // Marketing strings exist in all three languages; auth + app
    // namespaces exist only in he-IL/en-US. When a Russian-locale page
    // tries to read e.g. `auth.signIn.title` we fall back to en-US so
    // the user sees CPA-reviewed copy rather than the raw key.
    getMessageFallback({ namespace, key }) {
      const path = namespace ? `${namespace}.${key}` : key;
      if (locale === "ru-RU") {
        const en = enUS as Record<string, unknown>;
        const segments = path.split(".");
        let cursor: unknown = en;
        for (const segment of segments) {
          if (
            cursor &&
            typeof cursor === "object" &&
            segment in (cursor as Record<string, unknown>)
          ) {
            cursor = (cursor as Record<string, unknown>)[segment];
          } else {
            cursor = undefined;
            break;
          }
        }
        if (typeof cursor === "string") return cursor;
      }
      return path;
    },
    onError(error) {
      // ru-RU is marketing-only (Plan v4 Risk #24). App/auth namespaces
      // intentionally fall back to en-US via getMessageFallback, so
      // MISSING_MESSAGE noise for that locale is expected — suppress it.
      if (error.code === "MISSING_MESSAGE" && locale === "ru-RU") return;
      // pino lands in Phase A.6 — until then route i18n errors through
      // console.warn so they show up in Vercel logs without crashing
      // the render.
      // eslint-disable-next-line no-console
      console.warn("[next-intl]", error.message);
    },
  };
});
