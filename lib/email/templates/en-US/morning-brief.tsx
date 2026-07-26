import type { EmailTemplate, EmailTemplateProps } from "../types";
import {
  EmailLayout,
  EmailButton,
  Heading,
  Para,
  Muted,
} from "../layout";

// Morning Tax Brief email (EN). Mirror of the HE template. Route
// handler swaps in the dynamic sentence via fillText() on the text body
// and overrides `html` with the rendered RTL/LTR string when needed.

const subject = "Morning tax brief · סיכום מס בוקר";

function MorningBriefEn({ user, url }: EmailTemplateProps) {
  const link = url ?? "/en-US/dashboard";
  const greeting = user.name ? `Hi ${user.name},` : "Hi,";
  return (
    <EmailLayout
      dir="ltr"
      lang="en"
      preview="Your daily 08:00 brief — what to do today to stay calm with the tax authority."
    >
      <Muted dir="ltr">Tax brief · 08:00 local</Muted>
      <Heading dir="ltr">Your morning brief</Heading>
      <Para dir="ltr">{greeting}</Para>
      <Para dir="ltr">
        This is your daily brief — the VAT bill coming up, your cash on
        hand, and one action to keep you ahead of the tax authority.
        Estimates only — not tax advice.
      </Para>
      <EmailButton href={link}>Open dashboard</EmailButton>
      <Muted dir="ltr">
        To stop receiving daily briefs, open Settings in your account.
      </Muted>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  text: [
    "{sentence}",
    "",
    "Open the dashboard: {url}",
    "",
    "— AccounTech",
  ].join("\n"),
  Component: MorningBriefEn,
};

export default template;
