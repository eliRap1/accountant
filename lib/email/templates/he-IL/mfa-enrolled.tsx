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
  const greeting = user.name ? `שלום ${user.name},` : "שלום,";
  return (
    <EmailLayout
      dir="rtl"
      lang="he"
      preview="הוספת אפליקציית אימות לחשבון. אם זה לא היית/ה — פעלו מיד."
    >
      <Heading dir="rtl">נוספה אפליקציית אימות לחשבון</Heading>
      <Para dir="rtl">{greeting}</Para>
      <Para dir="rtl">
        זה עתה הוגדרה אפליקציית אימות (TOTP) לחשבון AccounTech שלך. החל מעכשיו
        יתבקש קוד בן 6 ספרות בכל התחברות.
      </Para>
      <Para dir="rtl">
        פרטי הפעולה:
        <br />
        כתובת IP:{" "}
        <span dir="ltr" style={{ fontFamily: "monospace" }}>
          {ip ?? "—"}
        </span>
        <br />
        דפדפן/מכשיר:{" "}
        <span dir="ltr" style={{ fontFamily: "monospace" }}>
          {ua ?? "—"}
        </span>
      </Para>
      <Para dir="rtl">
        <strong style={{ color: "#fca5a5" }}>אם זה לא היית/ה</strong> — מישהו
        עלול לגשת לחשבון. אפסו את הסיסמה והשבתו את האימות הדו-שלבי מיד.
      </Para>
      <EmailButton href={link}>פתיחת חלון התחברות</EmailButton>
      <Muted dir="rtl">
        שמרו את קודי השחזור במקום מאובטח — בלעדיהם איבוד המכשיר משמעו איבוד
        גישה לחשבון.
      </Muted>
    </EmailLayout>
  );
}

const template: EmailTemplate = {
  subject,
  text: [
    "שלום,",
    "",
    "הוגדרה אפליקציית אימות (TOTP) לחשבון AccounTech שלך.",
    "כתובת IP: {ip}",
    "דפדפן: {ua}",
    "",
    "אם זה לא היית/ה — היכנסו ואפסו את האימות הדו-שלבי מיד:",
    "{url}",
    "",
    "— AccounTech Security",
  ].join("\n"),
  Component: MFAEnrolled,
};

export default template;
