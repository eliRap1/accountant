import type { EmailTemplate, EmailTemplateProps } from "../types";
import {
  EmailLayout,
  EmailButton,
  Heading,
  Para,
  Muted,
} from "../layout";

// EN-US verification email. Subject still bilingual HE-first per runbook
// §5.1 because the From: domain serves a HE-IL inbox primarily — but the
// body is fully English when the user picked en-US in the locale switcher.
const subject = "אימות אימייל · Verify your email";

function VerifyEmail({ user, url }: EmailTemplateProps) {
  const link = url ?? "#";
  const greeting = user.name ? `Hi ${user.name},` : "Hi,";
  return (
    <EmailLayout
      dir="ltr"
      lang="en"
      preview="Click the button below to verify your email address."
    >
      <Heading dir="ltr">Verify your email</Heading>
      <Para dir="ltr">{greeting}</Para>
      <Para dir="ltr">
        We received a signup for AccounTech using{" "}
        <span style={{ fontFamily: "monospace" }}>{user.email}</span>. Click
        the button below to confirm — the link is valid for 24 hours.
      </Para>
      <EmailButton href={link}>Verify email</EmailButton>
      <Muted dir="ltr">
        If the button doesn&apos;t work, paste this URL into your browser:
        <br />
        <span
          style={{ fontFamily: "monospace", color: "#10b981", wordBreak: "break-all" }}
        >
          {link}
        </span>
      </Muted>
      <Muted dir="ltr">
        Didn&apos;t sign up? Ignore this message — no account is created until
        you click.
      </Muted>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  text: [
    "Hi,",
    "",
    "We received a signup for AccounTech. Verify your email here:",
    "{url}",
    "",
    "Link valid for 24h. Didn't sign up? Ignore this message.",
    "",
    "— AccounTech",
  ].join("\n"),
  Component: VerifyEmail,
};

export default template;
