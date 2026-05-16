import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import RecoveryCodesView from "./RecoveryCodesView";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.recoveryCodes" });
  return { title: t("metaTitle") };
}

export default function RecoveryCodesPage() {
  return (
    <Suspense fallback={null}>
      <RecoveryCodesView />
    </Suspense>
  );
}
