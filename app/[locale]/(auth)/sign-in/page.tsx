import { Suspense } from "react";
import SignInForm from "./SignInForm";

export const metadata = {
  title: "התחברות · AccounTech",
  description: "כניסה לחשבון AccounTech",
};

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
