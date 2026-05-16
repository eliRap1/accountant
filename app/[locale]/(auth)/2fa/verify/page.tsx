import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import TwoFactorVerifyForm from "./TwoFactorVerifyForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "auth.twoFactor.verify",
  });
  return { title: t("metaTitle") };
}

export default function TwoFactorVerifyPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorVerifyForm />
    </Suspense>
  );
}
