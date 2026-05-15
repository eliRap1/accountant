import { Suspense } from "react";
import TwoFactorVerifyForm from "./TwoFactorVerifyForm";

export const metadata = { title: "אימות דו-שלבי · AccounTech" };

export default function TwoFactorVerifyPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorVerifyForm />
    </Suspense>
  );
}
