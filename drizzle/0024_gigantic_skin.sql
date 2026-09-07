-- Branching video, part 1 (#143): the choice graph + the branch marker.
--
-- EXPAND-ONLY. Every new column is nullable or defaulted and no existing
-- column moves, so the build that predates this migration keeps serving on
-- the new schema (Drizzle bakes the column list into the build — apply this
-- BEFORE deploying the code, staging first, then production). There is no
-- contract phase: nothing is dropped, now or later.
--
-- Indexes: the two unique indexes below (composite (from, position) and the
-- partial "one default per fork") are plain, lock-holding CREATE INDEX — not
-- CONCURRENTLY — on purpose. episode_choices is created empty here and holds
-- one row per fork option (single digits per show, admin-written), so the
-- build is instantaneous and the write lock is held for nothing. The btree
-- of the composite unique also serves every from_episode_id lookup, so no
-- third plain index is created. The FK on episodes.branch_of_episode_id is a
-- constraint only (no index): the SET NULL cascade on a parent delete is an
-- admin-rare event on a table of a few dozen rows.
CREATE TABLE "episode_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_episode_id" uuid NOT NULL,
	"to_episode_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label_en" text NOT NULL,
	"label_es" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "episode_choices_from_position_unique" UNIQUE("from_episode_id","position")
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "branch_of_episode_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "fork_prompt_en" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "fork_prompt_es" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "fork_window_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_choices" ADD CONSTRAINT "episode_choices_from_episode_id_episodes_id_fk" FOREIGN KEY ("from_episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_choices" ADD CONSTRAINT "episode_choices_to_episode_id_episodes_id_fk" FOREIGN KEY ("to_episode_id") REFERENCES "public"."episodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_choices_from_default_unique" ON "episode_choices" USING btree ("from_episode_id") WHERE "episode_choices"."is_default";--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_branch_of_episode_id_episodes_id_fk" FOREIGN KEY ("branch_of_episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;