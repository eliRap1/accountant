import { Suspense } from "react";
import PasskeysManager from "./PasskeysManager";

export const metadata = { title: "מפתחות גישה · AccounTech" };

export default function PasskeysPage() {
  return (
    <Suspense fallback={null}>
      <PasskeysManager />
    </Suspense>
  );
}
