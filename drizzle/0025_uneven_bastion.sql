CREATE TABLE "erased_customers" (
	"stripe_customer_id" text PRIMARY KEY NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL
);
