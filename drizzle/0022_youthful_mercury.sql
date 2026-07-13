ALTER TABLE "show_reminders" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "show_reminders" ADD COLUMN "ip_hash" text;--> statement-breakpoint
CREATE INDEX "show_reminders_ip_hash_created_idx" ON "show_reminders" USING btree ("ip_hash","created_at");