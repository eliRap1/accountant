import { Suspense } from "react";
import TwoFactorEnrollForm from "./TwoFactorEnrollForm";

export const metadata = { title: "הפעלת אימות דו-שלבי · AccounTech" };

export default function TwoFactorEnrollPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorEnrollForm />
    </Suspense>
  );
}
