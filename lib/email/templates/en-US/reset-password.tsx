import type { EmailTemplate, EmailTemplateProps } from "../types";
import {
  EmailLayout,
  EmailButton,
  Heading,
  Para,
  Muted,
} from "../layout";

const subject = "איפוס סיסמה · Reset your password";

function ResetPassword({ user, url }: EmailTemplateProps) {
  const link = url ?? "#";
  const greeting = user.name ? `Hi ${user.name},` : "Hi,";
  return (
    <EmailLayout
      dir="ltr"
      lang="en"
      preview="Reset your AccounTech password. Link expires shortly."
    >
      <Heading dir="ltr">Reset your password</Heading>
      <Para dir="ltr">{greeting}</Para>
      <Para dir="ltr">
        Someone requested a password reset for your AccounTech account. If
        that was you, use the button below. The link is short-lived and
        single-use.
      </Para>
      <EmailButton href={link}>Reset password</EmailButton>
      <Muted dir="ltr">
        If the button doesn&apos;t work, paste this into your browser:
        <br />
        <span
          style={{ fontFamily: "monospace", color: "#10b981", wordBreak: "break-all" }}
        >
          {link}
        </span>
      </Muted>
      <Muted dir="ltr">
        Didn&apos;t request this? You can safely ignore the email — nothing
        changes until you click. If reset requests keep appearing, contact
        security@.
      </Muted>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  text: [
    "Hi,",
    "",
    "Reset your AccounTech password here:",
    "{url}",
    "",
    "Single-use link, expires shortly. Didn't request? Ignore this email.",
    "",
    "— AccounTech Security",
  ].join("\n"),
  Component: ResetPassword,
};

export default template;
