import { Suspense } from "react";
import ForgotPasswordForm from "./ForgotPasswordForm";

export const metadata = { title: "שכחתי סיסמה · AccounTech" };

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
