import { requireCurrentUser } from "@/lib/auth/serverSession";
import BusinessForm from "../BusinessForm";

export default async function NewBusinessPage() {
  // Auth-gate even if a future AppShell does the same — direct hits to
  // /:locale/businesses/new should fail closed.
  await requireCurrentUser();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <BusinessForm mode="new" />
    </div>
  );
}
