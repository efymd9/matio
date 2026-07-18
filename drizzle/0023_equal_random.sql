CREATE TABLE "visitor_days" (
	"aid" uuid NOT NULL,
	"day" date NOT NULL,
	"landed_home" boolean DEFAULT false NOT NULL,
	"show_viewed" boolean DEFAULT false NOT NULL,
	"wall_seen" boolean DEFAULT false NOT NULL,
	CONSTRAINT "visitor_days_aid_day_pk" PRIMARY KEY("aid","day")
);
--> statement-breakpoint
CREATE TABLE "visitors" (
	"aid" uuid PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_path" text,
	"referrer" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"country" text,
	"user_id" text,
	"linked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watch_days" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "watch_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "watch_segments" (
	"episode_id" uuid NOT NULL,
	"day" date NOT NULL,
	"bucket" integer NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "watch_segments_episode_id_day_bucket_pk" PRIMARY KEY("episode_id","day","bucket")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "max_position_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "total_watched_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "first_watched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "visitor_days" ADD CONSTRAINT "visitor_days_aid_visitors_aid_fk" FOREIGN KEY ("aid") REFERENCES "public"."visitors"("aid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_days" ADD CONSTRAINT "watch_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_segments" ADD CONSTRAINT "watch_segments_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visitor_days_day_idx" ON "visitor_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "visitors_user_id_idx" ON "visitors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "visitors_first_seen_at_idx" ON "visitors" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "watch_days_day_idx" ON "watch_days" USING btree ("day");--> statement-breakpoint
-- Backfill (hand-authored): rows that predate depth/retention tracking get
-- the best available approximations — the furthest KNOWN playhead is the
-- last-saved one, and the first-watch time is approximated by the last
-- save time (release-retention reads on pre-migration rows are last-touch).
-- total_watched_seconds stays 0: cumulative watch time genuinely wasn't
-- recorded before segment tracking, and inventing it would corrupt the
-- rewatch metric.
UPDATE "watch_progress" SET "max_position_seconds" = "position_seconds", "first_watched_at" = "updated_at";