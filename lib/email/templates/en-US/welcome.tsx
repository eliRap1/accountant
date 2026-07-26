import type { EmailTemplate, EmailTemplateProps } from "../types";
import {
  EmailLayout,
  EmailButton,
  Heading,
  Para,
} from "../layout";

const subject = "ברוכים הבאים ל-AccounTech · Welcome aboard";

function Welcome({ user, url }: EmailTemplateProps) {
  const link = url ?? "/en-US/sign-in";
  const greeting = user.name ? `Hi ${user.name},` : "Hi,";
  return (
    <EmailLayout
      dir="ltr"
      lang="en"
      preview="Your email is verified — you're in."
    >
      <Heading dir="ltr">Email verified. Welcome aboard.</Heading>
      <Para dir="ltr">{greeting}</Para>
      <Para dir="ltr">
        Your AccounTech account is ready. AccounTech is built for Israeli
        self-employed: compliant VAT invoices, receipt OCR, VAT estimates and
        ready-to-upload SHAAM files. Everything is computed from your data —
        not tax advice; run anything material past your CPA.
      </Para>
      <EmailButton href={link}>Open dashboard</EmailButton>
      <Para dir="ltr">Questions? We&apos;re at support@.</Para>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  text: [
    "Hi,",
    "",
    "Your email is verified. Your AccounTech account is ready.",
    "Open the dashboard: {url}",
    "",
    "Questions? support@.",
    "",
    "— AccounTech",
  ].join("\n"),
  Component: Welcome,
};

export default template;
