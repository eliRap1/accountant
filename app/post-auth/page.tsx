import { redirect } from "next/navigation";
import type { Route } from "next";
import { currentUser } from "@/lib/auth/serverSession";

// Landing page after sign-in / email-verification / 2FA. Resolves the
// session, ensures the app users row exists, then routes the user to
// onboarding (first time) or dashboard (returning).
//
// For Phase A.3 Chunk 1 onboarding/dashboard don't exist yet — both
// routes redirect to `/` so the flow is at least end-to-end testable.
export default async function PostAuthPage() {
  const u = await currentUser();
  if (!u) {
    redirect("/sign-in" as Route);
  }
  // TODO(B): redirect to /onboarding if user has no business yet,
  // otherwise to /dashboard.
  redirect("/" as Route);
}
