import { Suspense } from "react";
import VerifyEmailView from "./VerifyEmailView";

export const metadata = {
  title: "אימות אימייל · AccounTech",
};

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailView />
    </Suspense>
  );
}
