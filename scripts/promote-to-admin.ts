import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: pnpm promote-to-admin <email>");
    process.exit(1);
  }

  // Dynamic import so DATABASE_URL is populated before db/index loads it.
  const { db } = await import("../db/index.js");
  const { users } = await import("../db/schema/index.js");

  const rows = await db
    .update(users)
    .set({ role: "admin" })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email, role: users.role });

  if (rows.length === 0) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  console.log(
    `Promoted ${rows[0].email} (${rows[0].id}) → role=${rows[0].role}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
