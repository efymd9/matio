import { config } from "dotenv";
config({ path: ".env.local" });

// One-off check: are there any users with more than one row in
// subscriptions whose status is active/trialing/past_due? If yes, the
// partial unique index in migration 0008 would fail to apply — clean
// these up by hand (or by demoting the older row to 'canceled') before
// running pnpm db:migrate.

async function main() {
  const { db } = await import("../db/index.js");
  const { subscriptions } = await import("../db/schema/index.js");
  const { and, eq, inArray, count } = await import("drizzle-orm");

  const rows = await db
    .select({
      userId: subscriptions.userId,
      n: count(),
    })
    .from(subscriptions)
    .where(
      inArray(subscriptions.status, ["active", "trialing", "past_due"]),
    )
    .groupBy(subscriptions.userId);

  const dupes = rows.filter((r) => Number(r.n) > 1);
  if (dupes.length === 0) {
    console.log("OK: no users have more than one active-ish subscription.");
    process.exit(0);
  }
  console.error("Duplicate active-ish subscription rows per user:");
  for (const d of dupes) {
    const detail = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, d.userId),
          inArray(subscriptions.status, ["active", "trialing", "past_due"]),
        ),
      );
    console.error(`  user_id=${d.userId} n=${d.n}`, detail.map((r) => ({
      id: r.id,
      status: r.status,
      stripeSubscriptionId: r.stripeSubscriptionId,
      currentPeriodEnd: r.currentPeriodEnd,
      updatedAt: r.updatedAt,
    })));
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
