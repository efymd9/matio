CREATE TABLE "guest_checkout_sessions" (
	"claim_token_hash" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
