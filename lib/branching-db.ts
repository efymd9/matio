import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { episodeChoices } from "@/db/schema";

// The database half of lib/branching.ts (which stays PURE — no db there).
//
// One read, one meaning: "does some episode's choice lead HERE?" — the
// question both the episode page (hide the delete button and say why) and
// deleteEpisode (answer `episode_is_choice_target` instead of letting the
// RESTRICT FK fire) ask. It is one function so the two surfaces cannot
// drift: the season page, which knows nothing about edges, reaches the
// action and gets the same rule the episode page rendered (#195).
// The FK stays as the safety net for the race between this read and the
// DELETE.
export async function isChoiceTarget(episodeId: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: episodeChoices.id })
    .from(episodeChoices)
    .where(eq(episodeChoices.toEpisodeId, episodeId))
    .limit(1);
  return hit !== undefined;
}
