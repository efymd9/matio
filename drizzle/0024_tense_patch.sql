-- Expand-only (#164): a new table nobody reads until the code that writes it
-- deploys, so migrate first, deploy second. The only index is the primary
-- key on a table created empty — no lock trade-off to state: there is
-- nothing to lock. The table holds Stripe customer ids of erased accounts
-- (art. 17 tombstones) and is never pruned — see db/schema/erased_customers.ts.
CREATE TABLE "erased_customers" (
	"stripe_customer_id" text PRIMARY KEY NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL
);
