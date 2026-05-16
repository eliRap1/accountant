import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import TwoFactorEnrollForm from "./TwoFactorEnrollForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "auth.twoFactor.enroll",
  });
  return { title: t("metaTitle") };
}

export default function TwoFactorEnrollPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorEnrollForm />
    </Suspense>
  );
}
