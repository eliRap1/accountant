import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// Recurring-subscriptions detector. Groups expense transactions by a
// normalised "vendor" key (counterparty from metadata_jsonb, falling
// back to description). A group qualifies as recurring when:
//   - >= 3 transactions in the lookback window (default 180 days),
//   - the median consecutive-day-gap matches a cadence band,
//   - amounts are within 100%–200% of the smallest (rejects coincidences).
//
// Output is in major ILS units. Cadence is reported as "monthly" /
// "weekly" so the UI can render an estimated monthly cost without
// re-deriving the math.

export type RecurringCadence = "monthly" | "weekly";

export type RecurringSubscription = {
  vendor: string;
  occurrences: number;
  cadence: RecurringCadence;
  medianAmountMajor: number;
  monthlyCostMajor: number;
  lastSeenIso: string;
};

export type RecurringSubscriptions = {
  windowDays: number;
  subscriptions: RecurringSubscription[];
  totalMonthlyMajor: number;
};

type DbRow = {
  vendor: string;
  txn_date: string;
  amount_minor: string;
};

const MIN_OCCURRENCES = 3;
const MAX_VENDORS = 30;
const MONTHLY_BAND = { min: 27, max: 33 };
const WEEKLY_BAND = { min: 6, max: 8 };
// 365 / 7 / 12 ≈ 4.345 — average number of weeks per calendar month
const WEEKS_PER_MONTH = 365 / 7 / 12;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function classifyCadence(gapDays: number): RecurringCadence | null {
  if (gapDays >= MONTHLY_BAND.min && gapDays <= MONTHLY_BAND.max) return "monthly";
  if (gapDays >= WEEKLY_BAND.min && gapDays <= WEEKLY_BAND.max) return "weekly";
  return null;
}

export async function getRecurringSubscriptions(
  userId: string,
  opts: { windowDays?: number; now?: Date } = {},
): Promise<RecurringSubscriptions> {
  const windowDays = opts.windowDays ?? 180;
  const now = opts.now ?? new Date();
  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - windowDays);
  const startIso = startDate.toISOString().slice(0, 10);

  const rows = await withUser(userId, async (tx) => {
    return (await tx.execute(
      sql`SELECT LOWER(TRIM(COALESCE(metadata_jsonb->>'counterparty', description, ''))) AS vendor,
                 txn_date::text,
                 amount_minor::text
          FROM transactions
          WHERE direction = 'expense'
            AND txn_date >= ${startIso}::date
            AND COALESCE(metadata_jsonb->>'counterparty', description, '') <> ''
          ORDER BY txn_date DESC`,
    )) as unknown as DbRow[];
  });

  const groups = new Map<string, DbRow[]>();
  for (const r of rows) {
    if (!r.vendor) continue;
    const arr = groups.get(r.vendor) ?? [];
    arr.push(r);
    groups.set(r.vendor, arr);
  }

  const subs: RecurringSubscription[] = [];
  for (const [vendor, list] of groups) {
    if (list.length < MIN_OCCURRENCES) continue;

    const sortedAsc = [...list].sort((a, b) =>
      a.txn_date.localeCompare(b.txn_date),
    );
    const gaps: number[] = [];
    for (let i = 1; i < sortedAsc.length; i++) {
      const prev = new Date(sortedAsc[i - 1]!.txn_date + "T00:00:00Z").getTime();
      const cur = new Date(sortedAsc[i]!.txn_date + "T00:00:00Z").getTime();
      gaps.push((cur - prev) / 86_400_000);
    }
    const medianGap = median(gaps);
    const cadence = classifyCadence(medianGap);
    if (!cadence) continue;

    const amounts = list.map((r) => Number(BigInt(r.amount_minor)));
    const minAmt = Math.min(...amounts);
    const maxAmt = Math.max(...amounts);
    // A zero-amount row almost always indicates a void / data-quality bug.
    // Including it in a "subscription" group would understate the median.
    if (minAmt === 0) continue;
    if (maxAmt / minAmt > 2) continue;

    const medianMinor = median(amounts);
    const occurrencesPerMonth = cadence === "weekly" ? WEEKS_PER_MONTH : 1;
    const monthlyCostMinor = medianMinor * occurrencesPerMonth;

    subs.push({
      vendor,
      occurrences: list.length,
      cadence,
      medianAmountMajor: medianMinor / 100,
      monthlyCostMajor: monthlyCostMinor / 100,
      lastSeenIso: sortedAsc[sortedAsc.length - 1]!.txn_date,
    });
  }

  subs.sort((a, b) => b.monthlyCostMajor - a.monthlyCostMajor);
  const trimmed = subs.slice(0, MAX_VENDORS);
  const totalMonthlyMajor = trimmed.reduce(
    (acc, s) => acc + s.monthlyCostMajor,
    0,
  );

  return { windowDays, subscriptions: trimmed, totalMonthlyMajor };
}
