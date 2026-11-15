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
  const greeting = user.name ? `שלום ${user.name},` : "שלום,";
  return (
    <EmailLayout
      dir="rtl"
      lang="he"
      preview="לחצו כדי לאפס את הסיסמה. הקישור תקף לזמן קצר."
    >
      <Heading dir="rtl">איפוס סיסמה</Heading>
      <Para dir="rtl">{greeting}</Para>
      <Para dir="rtl">
        קיבלנו בקשה לאיפוס הסיסמה של חשבון AccounTech שלך. אם זה היית את/ה,
        לחצו על הכפתור. הקישור תקף לזמן קצר ויפוג לאחר שימוש.
      </Para>
      <EmailButton href={link}>איפוס סיסמה</EmailButton>
      <Muted dir="rtl">
        אם הכפתור לא עובד, העתיקו את הכתובת:
        <br />
        <span
          dir="ltr"
          style={{ fontFamily: "monospace", color: "#10b981", wordBreak: "break-all" }}
        >
          {link}
        </span>
      </Muted>
      <Muted dir="rtl">
        לא ביקשת/ה איפוס? אפשר להתעלם — הסיסמה לא תשתנה ללא הקלקה. אם
        מתבצעות בקשות חוזרות שלא יזמת/ה, פנו ל-security@.
      </Muted>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  text: [
    "שלום,",
    "",
    "התקבלה בקשה לאיפוס הסיסמה של חשבון AccounTech שלך. לאיפוס:",
    "{url}",
    "",
    "הקישור תקף לזמן קצר ויפוג לאחר שימוש. לא ביקשת/ה איפוס? התעלמו מההודעה.",
    "",
    "— AccounTech Security",
  ].join("\n"),
  Component: ResetPassword,
};

export default template;
