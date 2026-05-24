import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { getMux } from "@/lib/mux";

// Webhooks need the raw body for signature verification + DB writes via
// postgres-js; both want the Node runtime.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const signingSecret = process.env.MUX_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("MUX_WEBHOOK_SIGNING_SECRET not set");
    return new Response("Webhook signing secret not configured", {
      status: 500,
    });
  }

  const body = await req.text();

  let event: Awaited<ReturnType<ReturnType<typeof getMux>["webhooks"]["unwrap"]>>;
  try {
    event = await getMux().webhooks.unwrap(body, req.headers, signingSecret);
  } catch (err) {
    console.error("Mux webhook signature verification failed:", err);
    return new Response("Bad signature", { status: 400 });
  }

  if (event.type === "video.asset.ready") {
    const { id, passthrough, playback_ids, duration } = event.data;
    const target = await resolveEpisodeFromPassthrough(passthrough, id, event.type);
    if (target) {
      const first = playback_ids?.[0];
      await db
        .update(episodes)
        .set({
          muxAssetId: id,
          muxPlaybackId: first?.id ?? null,
          muxPlaybackPolicy: first?.policy ?? null,
          durationSeconds:
            typeof duration === "number" ? Math.round(duration) : null,
          status: "ready",
        })
        .where(eq(episodes.id, target.id));
    }
  } else if (event.type === "video.asset.errored") {
    const { id, passthrough } = event.data;
    const target = await resolveEpisodeFromPassthrough(passthrough, id, event.type);
    if (target) {
      await db
        .update(episodes)
        .set({ status: "errored", muxAssetId: id })
        .where(eq(episodes.id, target.id));
    }
  }

  return new Response("OK", { status: 200 });
}

// Mux's `passthrough` field is operator-editable (anyone with Mux dashboard
// access can change it on an asset after upload), and a compromised webhook
// signing secret turns any signed body into a valid event. Don't blindly
// trust passthrough as an episode id: verify the row exists, and reject
// events that try to re-point an episode at a different Mux asset than the
// one already attached. Falls back to 200 + warn log so we don't trigger a
// Mux retry storm on a malformed/forged event.
async function resolveEpisodeFromPassthrough(
  passthrough: string | undefined,
  assetId: string,
  eventType: string,
): Promise<{ id: string } | null> {
  if (!passthrough || !/^[0-9a-f-]{36}$/i.test(passthrough)) {
    console.warn(`${eventType} with invalid passthrough`, {
      assetId,
      passthrough,
    });
    return null;
  }
  const [row] = await db
    .select({ id: episodes.id, muxAssetId: episodes.muxAssetId })
    .from(episodes)
    .where(eq(episodes.id, passthrough))
    .limit(1);
  if (!row) {
    console.warn(`${eventType} passthrough matches no episode`, {
      assetId,
      passthrough,
    });
    return null;
  }
  if (row.muxAssetId && row.muxAssetId !== assetId) {
    // Episode already attached to a different asset — refuse to overwrite.
    // This blocks the "edit passthrough in Mux dashboard to redirect events
    // at someone else's episode" attack.
    console.warn(`${eventType} would re-point episode to a different asset`, {
      assetId,
      passthrough,
      existingMuxAssetId: row.muxAssetId,
    });
    return null;
  }
  return { id: row.id };
}
