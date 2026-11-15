import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import PasskeysManager from "./PasskeysManager";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.passkeys" });
  return { title: t("metaTitle") };
}

export default function PasskeysPage() {
  return (
    <Suspense fallback={null}>
      <PasskeysManager />
    </Suspense>
  );
}
