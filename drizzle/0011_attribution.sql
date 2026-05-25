ALTER TABLE "users" ADD COLUMN "attribution_first_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attribution_first_medium" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attribution_first_campaign" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attribution_last_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attribution_last_medium" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attribution_last_campaign" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "attribution_first_source" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "attribution_first_medium" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "attribution_first_campaign" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "attribution_last_source" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "attribution_last_medium" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "attribution_last_campaign" text;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "attribution_first_source" text;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "attribution_first_medium" text;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "attribution_first_campaign" text;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "attribution_last_source" text;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "attribution_last_medium" text;--> statement-breakpoint
ALTER TABLE "trial_sessions" ADD COLUMN "attribution_last_campaign" text;