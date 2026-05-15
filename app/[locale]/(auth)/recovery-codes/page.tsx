import { Suspense } from "react";
import RecoveryCodesView from "./RecoveryCodesView";

export const metadata = { title: "קודי שחזור · AccounTech" };

export default function RecoveryCodesPage() {
  return (
    <Suspense fallback={null}>
      <RecoveryCodesView />
    </Suspense>
  );
}
