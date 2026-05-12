import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import Mux from "@mux/mux-node";

async function main() {
  const { db } = await import("../db/index.js");
  const { episodes } = await import("../db/schema/index.js");

  if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
    throw new Error("MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set");
  }
  const mux = new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_TOKEN_SECRET,
  });

  const rows = await db
    .select({
      id: episodes.id,
      muxPlaybackId: episodes.muxPlaybackId,
    })
    .from(episodes)
    .where(
      and(
        isNotNull(episodes.muxPlaybackId),
        isNull(episodes.muxPlaybackPolicy),
      ),
    );

  if (rows.length === 0) {
    console.log("Nothing to backfill — every ready episode has a policy.");
    return;
  }

  console.log(`Backfilling ${rows.length} episode(s)…`);

  for (const row of rows) {
    try {
      const playbackId = await mux.video.playbackIds.retrieve(
        row.muxPlaybackId!,
      );
      const policy = playbackId.policy;
      if (!policy) {
        console.warn(`  ${row.id}: Mux returned no policy, skipping`);
        continue;
      }
      await db
        .update(episodes)
        .set({ muxPlaybackPolicy: policy })
        .where(eq(episodes.id, row.id));
      console.log(`  ${row.id}: ${row.muxPlaybackId} → ${policy}`);
    } catch (err) {
      console.error(`  ${row.id}: failed —`, err instanceof Error ? err.message : err);
    }
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
