import { config } from "dotenv";
config({ path: ".env.local" });

// One-off cleanup: hard-delete every show with a `demo-` slug prefix.
// These were seeded by scripts/seed-fake-shows.ts as catalog filler and
// have no real seasons / episodes attached, so the FK cascade
// (shows → seasons → episodes → trial_sessions) is a no-op for them.
//
// Idempotent: re-running after a successful delete returns 0 rows.
// Run: `pnpm tsx scripts/delete-demo-shows.ts`

async function main() {
  const { db } = await import("../db/index.js");
  const { shows } = await import("../db/schema/index.js");
  const { like } = await import("drizzle-orm");

  const targets = await db
    .select({ slug: shows.slug, title: shows.title })
    .from(shows)
    .where(like(shows.slug, "demo-%"));

  if (targets.length === 0) {
    console.log("No demo-* shows to delete.");
    process.exit(0);
  }

  console.log(`About to delete ${targets.length} demo show(s):`);
  for (const t of targets) console.log(`  - ${t.slug}  (${t.title})`);

  const deleted = await db
    .delete(shows)
    .where(like(shows.slug, "demo-%"))
    .returning({ slug: shows.slug });

  console.log(`\nDeleted ${deleted.length} row(s) from shows.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
