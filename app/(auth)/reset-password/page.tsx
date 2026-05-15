import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

export const metadata = { title: "סיסמה חדשה · AccounTech" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
