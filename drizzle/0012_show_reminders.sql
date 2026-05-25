CREATE TABLE "show_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "show_reminders_show_id_email_unique" UNIQUE("show_id","email")
);
--> statement-breakpoint
ALTER TABLE "show_reminders" ADD CONSTRAINT "show_reminders_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_reminders" ADD CONSTRAINT "show_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "show_reminders_show_id_idx" ON "show_reminders" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "show_reminders_show_id_pending_idx" ON "show_reminders" USING btree ("show_id","created_at") WHERE notified_at IS NULL;