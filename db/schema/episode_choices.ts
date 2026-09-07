import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { episodes } from "./episodes";

// The edges of the branching-video graph (#143). Each row is one way out of
// `from_episode_id`; what the set of rows MEANS is decided by its size
// (lib/branching.ts:resolveNextStep):
//   ≥2 rows — a fork: the parent's fork_prompt_* is shown with these labels
//             and the viewer picks one (targets must be branches OF THIS
//             episode, i.e. episodes.branch_of_episode_id = from);
//   1 row   — a silent auto-transition, no prompt (this is how a branch
//             converges back into the shared next episode; the target may
//             be any ready episode of the show);
//   0 rows  — a branch with none is an ending; a regular episode with none
//             keeps today's linear `episodes[idx+1]` behaviour.
// Labels are viewer copy, so es/en (site locales). The branch rows
// themselves are ordinary `episodes` — nothing about playback, tokens or
// progress changes; this table only tells the player where to go next.
export const episodeChoices = pgTable(
  "episode_choices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Deleting the parent deletes its outgoing edges (nothing to choose
    // from any more); deleting a TARGET is refused while an edge points at
    // it — the admin removes the choice first, so a fork can never dangle.
    fromEpisodeId: uuid("from_episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    toEpisodeId: uuid("to_episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "restrict" }),
    // 1-based display order of the option on the prompt.
    position: integer("position").notNull(),
    labelEn: text("label_en").notNull(),
    labelEs: text("label_es").notNull(),
    // The option the player takes when the timer runs out. At most one per
    // fork (partial unique below); a silent single row needs none.
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [
    unique("episode_choices_from_position_unique").on(
      t.fromEpisodeId,
      t.position,
    ),
    // "At most one default per fork" — same partial-unique idiom as the
    // subscriptions "one access-granting row per user" index. Its btree
    // together with the composite unique above already serves every
    // from_episode_id lookup, so there is no separate plain index.
    uniqueIndex("episode_choices_from_default_unique")
      .on(t.fromEpisodeId)
      .where(sql`${t.isDefault}`),
  ],
);

export type EpisodeChoice = typeof episodeChoices.$inferSelect;
export type NewEpisodeChoice = typeof episodeChoices.$inferInsert;
