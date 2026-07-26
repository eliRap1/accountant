import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import SignUpForm from "./SignUpForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signUp" });
  return { title: t("metaTitle") };
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm
        turnstileSiteKey={
          process.env["NEXT_PUBLIC_TURNSTILE_SITE_KEY"] ?? ""
        }
      />
    </Suspense>
  );
}
