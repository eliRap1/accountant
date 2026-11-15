import type { EmailTemplate, EmailTemplateProps } from "../types";
import {
  EmailLayout,
  EmailButton,
  Heading,
  Para,
  Muted,
} from "../layout";

// Morning Tax Brief email (HE).
//
// The actual sentence is rendered upstream by lib/ai/morningBriefSentence.ts
// and substituted into `{sentence}` inside the plain-text fallback. For the
// React component we accept the sentence via `url` is the dashboard link —
// that field already exists on EmailTemplateProps. We use the (optional)
// `text` plain-text body to ferry both — but for the React render we treat
// the user.name as the only personalisation and rely on the route handler
// to swap the React component's children with the pre-rendered sentence.
//
// To stay within the existing `EmailTemplateProps` contract we pass the
// sentence by mutating `text` at send-time. The React Component below
// renders a stable template; the sentence is shown as the primary Para.
//
// Route handlers that want the dynamic sentence call this template's
// `Component({ user, url, locale })` and additionally provide the sentence
// + CTA labels via the `dispatch.ts` `fillText` substitution on `text`.

const subject = "סיכום מס בוקר · Morning tax brief";

function MorningBriefHe({ user, url }: EmailTemplateProps) {
  // The dashboard CTA. /he-IL/dashboard is the canonical destination —
  // VAT tab lives under /tax/(vat) per the spec.
  const link = url ?? "/he-IL/dashboard";
  const greeting = user.name ? `שלום ${user.name},` : "שלום,";
  return (
    <EmailLayout
      dir="rtl"
      lang="he"
      preview="הסיכום היומי שלך — מה צריך לעשות היום כדי להישאר רגוע מול מס הכנסה."
    >
      <Muted dir="rtl">סיכום מס · 08:00 בבוקר</Muted>
      <Heading dir="rtl">סיכום הבוקר שלך</Heading>
      <Para dir="rtl">{greeting}</Para>
      <Para dir="rtl">
        {/*
          IMPORTANT: This paragraph is intentionally generic. The route
          handler renders the dynamic sentence and overrides the email's
          `html` field directly. The React surface is the fallback when
          the route handler chooses static rendering.
        */}
        זה הסיכום היומי שלך — המע&quot;מ הצפוי לתקופה הקרובה, מצב המזומנים,
        ופעולה אחת שתעזור לך להישאר רגוע. הכל אומדן, לא ייעוץ.
      </Para>
      <EmailButton href={link}>פתח את הדשבורד</EmailButton>
      <Muted dir="rtl">
        כדי להפסיק לקבל סיכומים יומיים, פתחו את ההגדרות בחשבון.
      </Muted>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  // Plain-text fallback. {sentence} = the dynamic sentence from
  // morningBriefSentence.ts; {url} = the dashboard CTA. Route handler
  // substitutes both via fillText().
  text: [
    "{sentence}",
    "",
    "פתחו את הדשבורד: {url}",
    "",
    "— AccounTech",
  ].join("\n"),
  Component: MorningBriefHe,
};

export default template;
