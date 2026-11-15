import type { EmailTemplate, EmailTemplateProps } from "../types";
import {
  EmailLayout,
  EmailButton,
  Heading,
  Para,
} from "../layout";

const subject = "ברוכים הבאים ל-AccounTech · Welcome aboard";

function Welcome({ user, url }: EmailTemplateProps) {
  // Dashboard route once it exists. Until then we drop into the sign-in
  // page — Better Auth redirects an authed user onward.
  const link = url ?? "/he-IL/sign-in";
  const greeting = user.name ? `שלום ${user.name},` : "שלום,";
  return (
    <EmailLayout
      dir="rtl"
      lang="he"
      preview="האימייל אומת — אפשר להתחיל לעבוד."
    >
      <Heading dir="rtl">האימייל אומת. תודה שהצטרפת.</Heading>
      <Para dir="rtl">{greeting}</Para>
      <Para dir="rtl">
        החשבון שלך מוכן. AccounTech בנויה לעצמאיים בישראל — חשבוניות מע&quot;מ
        תקניות, OCR לקבלות, אומדן מע&quot;מ ולוחיות SHAAM מוכנות להעלאה. הכל
        כתוצאה של עבודה על הנתונים שלך, לא כייעוץ — לבדיקה סופית פנו לרו&quot;ח.
      </Para>
      <EmailButton href={link}>למסך העבודה</EmailButton>
      <Para dir="rtl">
        שאלות? אנחנו פה: support@.
      </Para>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  text: [
    "שלום,",
    "",
    "האימייל אומת. החשבון שלך ב-AccounTech מוכן.",
    "כניסה למסך העבודה: {url}",
    "",
    "שאלות? פנו ל-support@.",
    "",
    "— AccounTech",
  ].join("\n"),
  Component: Welcome,
};

export default template;
