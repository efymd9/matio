ALTER TABLE "shows" ADD COLUMN "free_episodes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "member_episodes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "kind" text DEFAULT 'preview' NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "furthest_episode_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "last_episode_id" uuid;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "signup_wall_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD CONSTRAINT "trial_sessions_last_episode_id_episodes_id_fk" FOREIGN KEY ("last_episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;