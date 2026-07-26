import type { EmailTemplate, EmailTemplateProps } from "../types";
import {
  EmailLayout,
  EmailButton,
  Heading,
  Para,
  Muted,
} from "../layout";

// Hebrew verification email. Sent on signup when `requireEmailVerification:
// true` fires Better Auth's `sendVerificationEmail` hook.
//
// Subject naming follows runbook §5.1: bilingual HE first then EN in
// parens, under 70 visual chars so it doesn't truncate on mobile.
const subject = "אימות אימייל · Verify your email";

function VerifyEmail({ user, url }: EmailTemplateProps) {
  const link = url ?? "#";
  const greeting = user.name ? `שלום ${user.name},` : "שלום,";
  return (
    <EmailLayout
      dir="rtl"
      lang="he"
      preview="הקליקו על הקישור כדי לאמת את כתובת האימייל שלכם"
    >
      <Heading dir="rtl">אימות כתובת האימייל</Heading>
      <Para dir="rtl">{greeting}</Para>
      <Para dir="rtl">
        קיבלנו בקשת הרשמה לחשבון AccounTech עבור{" "}
        <span dir="ltr" style={{ fontFamily: "monospace" }}>
          {user.email}
        </span>
        . כדי להמשיך לחצו על הכפתור — הקישור תקף ל-24 שעות.
      </Para>
      <EmailButton href={link}>אימות האימייל</EmailButton>
      <Muted dir="rtl">
        אם הכפתור לא עובד, העתיקו את הכתובת לדפדפן:
        <br />
        <span
          dir="ltr"
          style={{ fontFamily: "monospace", color: "#10b981", wordBreak: "break-all" }}
        >
          {link}
        </span>
      </Muted>
      <Muted dir="rtl">
        לא ביקשתם הרשמה? התעלמו מהמייל — לא יווצר חשבון ללא לחיצה על הקישור.
      </Muted>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  // Plain-text fallback. {url} is a marker the dispatcher swaps. Required
  // for deliverability — Gmail downranks pure-HTML mail.
  text: [
    "שלום,",
    "",
    "קיבלנו בקשת הרשמה לחשבון AccounTech. כדי לאמת את האימייל לחצו על הקישור:",
    "{url}",
    "",
    "הקישור תקף ל-24 שעות. אם לא ביקשתם הרשמה — התעלמו מההודעה.",
    "",
    "— AccounTech",
  ].join("\n"),
  Component: VerifyEmail,
};

export default template;
