CREATE TYPE "public"."episode_access" AS ENUM('free', 'member', 'subscriber');--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "access" "episode_access" DEFAULT 'subscriber' NOT NULL;--> statement-breakpoint
WITH ranked AS (
  SELECT e.id,
         row_number() OVER (PARTITION BY se.show_id ORDER BY se.number, e.number) AS pos,
         s.free_episodes, s.member_episodes
  FROM episodes e
  JOIN seasons se ON e.season_id = se.id
  JOIN shows s ON se.show_id = s.id
  WHERE e.status = 'ready' AND s.free_episodes + s.member_episodes > 0
)
UPDATE episodes SET access = CASE
  WHEN ranked.pos <= ranked.free_episodes THEN 'free'
  WHEN ranked.pos <= ranked.free_episodes + ranked.member_episodes THEN 'member'
  ELSE 'subscriber'
END::episode_access
FROM ranked WHERE episodes.id = ranked.id;