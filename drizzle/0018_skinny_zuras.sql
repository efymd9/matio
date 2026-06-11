CREATE TYPE "public"."show_orientation" AS ENUM('horizontal', 'vertical');--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "orientation" "show_orientation" DEFAULT 'horizontal' NOT NULL;