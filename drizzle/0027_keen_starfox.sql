-- Story ideas from the public /ideas landing (#297): idea_submissions + the
-- idea_kind enum.
--
-- EXPAND-ONLY. A new enum, a new table, its unique constraint, its index and
-- an FK FROM this table to shows — nothing existing is altered, and there is
-- no contract phase: nothing is dropped, now or later. Order: staging first,
-- then merge, then production BEFORE the release that carries the code. That
-- code reads idea_submissions on background paths too (the retention cron,
-- the Clerk user.deleted erasure, the export, unsubscribe), so a release
-- without this table breaks account erasure with 42P01.
--
-- Index and constraint: the (email, content_hash) UNIQUE is a constraint
-- inside CREATE TABLE (Drizzle's shape, the ON CONFLICT target of submitIdea)
-- and created_at_idx is a plain, lock-holding CREATE INDEX — not CONCURRENTLY
-- — on purpose. The table is created empty right here, so both builds are
-- instantaneous and the write lock holds nothing back; CONCURRENTLY would
-- need a separate non-transactional migration file for no gain.
--
-- No index on show_id: shows are soft-deleted, and the SET NULL cascade of
-- a rare hard delete scans a small table. Add one once the table grows past
-- ~10^4 rows.
CREATE TYPE "public"."idea_kind" AS ENUM('continuation', 'new_series');--> statement-breakpoint
CREATE TABLE "idea_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "idea_kind" NOT NULL,
	"show_id" uuid,
	"working_title" text,
	"logline" text NOT NULL,
	"story" text NOT NULL,
	"author_name" text NOT NULL,
	"email" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"terms_version" text NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"content_hash" text NOT NULL,
	"attribution_first_source" text,
	"attribution_first_medium" text,
	"attribution_first_campaign" text,
	"attribution_last_source" text,
	"attribution_last_medium" text,
	"attribution_last_campaign" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_submissions_email_content_hash_unique" UNIQUE("email","content_hash")
);
--> statement-breakpoint
ALTER TABLE "idea_submissions" ADD CONSTRAINT "idea_submissions_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idea_submissions_created_at_idx" ON "idea_submissions" USING btree ("created_at");