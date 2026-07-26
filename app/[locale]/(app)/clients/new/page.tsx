import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import ClientForm, { type BusinessOption } from "../ClientForm";

export default async function NewClientPage() {
  const me = await requireCurrentUser();
  const businesses = (await withUser(me.appUserId, async (tx) => {
    return (await tx.execute(
      sql`SELECT id, legal_name AS "legalName"
          FROM businesses
          WHERE owner_user_id = ${me.appUserId}::uuid
            AND deleted_at IS NULL
          ORDER BY legal_name ASC`,
    )) as unknown as BusinessOption[];
  })) as BusinessOption[];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <ClientForm mode="new" businesses={businesses} />
    </div>
  );
}
