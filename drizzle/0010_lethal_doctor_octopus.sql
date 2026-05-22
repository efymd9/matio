ALTER TABLE "subscriptions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Backfill: without this, every pre-existing row would carry a synthetic
-- created_at = the migration timestamp, which makes the
-- "cancellations in the last N days" analytics meaningless. updated_at
-- is the best historical proxy we have (the row was first written via
-- INSERT, which also stamped updated_at via defaultNow()).
UPDATE "subscriptions" SET "created_at" = "updated_at";--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_updated_at_idx" ON "subscriptions" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trial_sessions_show_id_idx" ON "trial_sessions" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "trial_sessions_user_id_idx" ON "trial_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watch_progress_episode_id_idx" ON "watch_progress" USING btree ("episode_id");