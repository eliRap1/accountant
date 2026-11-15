import type { EmailTemplate, EmailTemplateProps } from "../types";
import {
  EmailLayout,
  EmailButton,
  Heading,
  Para,
  Muted,
} from "../layout";

const subject = "אומת אימות דו-שלבי · Authenticator app added";

function MFAEnrolled({ user, url, ip, ua }: EmailTemplateProps) {
  const link = url ?? "/sign-in";
  const greeting = user.name ? `Hi ${user.name},` : "Hi,";
  return (
    <EmailLayout
      dir="ltr"
      lang="en"
      preview="An authenticator app was added to your account. If this wasn't you, act now."
    >
      <Heading dir="ltr">Authenticator app added</Heading>
      <Para dir="ltr">{greeting}</Para>
      <Para dir="ltr">
        A TOTP authenticator app was just added to your AccounTech account.
        From now on, you&apos;ll need a 6-digit code every time you sign in.
      </Para>
      <Para dir="ltr">
        Activity details:
        <br />
        IP address:{" "}
        <span style={{ fontFamily: "monospace" }}>{ip ?? "—"}</span>
        <br />
        Browser / device:{" "}
        <span style={{ fontFamily: "monospace" }}>{ua ?? "—"}</span>
      </Para>
      <Para dir="ltr">
        <strong style={{ color: "#fca5a5" }}>If this wasn&apos;t you</strong>,
        someone may be accessing your account. Reset your password and remove
        MFA immediately.
      </Para>
      <EmailButton href={link}>Open sign-in</EmailButton>
      <Muted dir="ltr">
        Store your recovery codes somewhere safe — without them, losing your
        phone means losing the account.
      </Muted>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  text: [
    "Hi,",
    "",
    "A TOTP authenticator was added to your AccounTech account.",
    "IP: {ip}",
    "User agent: {ua}",
    "",
    "If this wasn't you, sign in and reset MFA immediately:",
    "{url}",
    "",
    "— AccounTech Security",
  ].join("\n"),
  Component: MFAEnrolled,
};

export default template;
