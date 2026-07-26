import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

// Fallback route — the commit is performed via the server action that
// ParseReview triggers, so /commit on its own just redirects back to
// the parent review page. We keep this route so a stray /commit URL
// (e.g. from a bookmark) doesn't 404.
export default async function CommitFallbackPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const locale = await getLocale();
  redirect({ href: `/bank-imports/${id}`, locale });
}
