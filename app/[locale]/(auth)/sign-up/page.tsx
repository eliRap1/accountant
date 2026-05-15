import { Suspense } from "react";
import SignUpForm from "./SignUpForm";

export const metadata = {
  title: "הרשמה · AccounTech",
  description: "פתיחת חשבון AccounTech",
};

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm
        turnstileSiteKey={
          process.env["NEXT_PUBLIC_TURNSTILE_SITE_KEY"] ?? ""
        }
      />
    </Suspense>
  );
}
