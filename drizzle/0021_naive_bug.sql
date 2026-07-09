CREATE TABLE "actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"bio" text,
	"avatar_image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "show_actors" (
	"show_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"character_name" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "show_actors_show_id_actor_id_pk" PRIMARY KEY("show_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "show_actors" ADD CONSTRAINT "show_actors_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_actors" ADD CONSTRAINT "show_actors_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "show_actors_actor_id_idx" ON "show_actors" USING btree ("actor_id");