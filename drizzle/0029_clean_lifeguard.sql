-- Job applications from the public /careers page (#376): job_applications +
-- the job_position enum (the vacancy ids of lib/careers.ts).
--
-- EXPAND-ONLY. A new enum, a new table, its unique constraint and its index —
-- nothing existing is altered, and there is no contract phase: nothing is
-- dropped, now or later. Order: staging first, then merge, then production
-- BEFORE the release that carries the code. That code touches
-- job_applications on background paths too (the retention cron, the Clerk
-- user.deleted erasure and the app's «Delete account», the users mirror's late
-- erasure, the art. 15/20 exports), so a release without this table breaks
-- account erasure with 42P01 (the 0027 lesson).
--
-- Index and constraint: the (email, position, content_hash) UNIQUE is a
-- constraint inside CREATE TABLE (Drizzle's shape, the ON CONFLICT target of
-- submitJobApplication; its leading email column also serves the by-address
-- erasure and export) and created_at_idx is a plain, lock-holding CREATE
-- INDEX — not CONCURRENTLY — on purpose. The table is created empty right
-- here, so both builds are instantaneous and the write lock holds nothing
-- back; CONCURRENTLY would need a separate non-transactional migration file
-- for no gain. created_at_idx serves the admin list (newest first, also when
-- filtered by position — a small table, capped at 500 rows a page) and the
-- retention cron's window scan.
CREATE TYPE "public"."job_position" AS ENUM('ai-creator', 'sales-distribution');--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" "job_position" NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"location" text NOT NULL,
	"linkedin_url" text,
	"portfolio_url" text,
	"social_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_applications_email_position_content_hash_unique" UNIQUE("email","position","content_hash")
);
--> statement-breakpoint
CREATE INDEX "job_applications_created_at_idx" ON "job_applications" USING btree ("created_at");