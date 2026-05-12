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

  let event;
  try {
    event = await getMux().webhooks.unwrap(body, req.headers, signingSecret);
  } catch (err) {
    console.error("Mux webhook signature verification failed:", err);
    return new Response("Bad signature", { status: 400 });
  }

  if (event.type === "video.asset.ready") {
    const { id, passthrough, playback_ids, duration } = event.data;
    if (!passthrough) {
      console.warn("video.asset.ready without passthrough", { assetId: id });
    } else {
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
        .where(eq(episodes.id, passthrough));
    }
  } else if (event.type === "video.asset.errored") {
    const { id, passthrough } = event.data;
    if (!passthrough) {
      console.warn("video.asset.errored without passthrough", { assetId: id });
    } else {
      await db
        .update(episodes)
        .set({ status: "errored", muxAssetId: id })
        .where(eq(episodes.id, passthrough));
    }
  }

  return new Response("OK", { status: 200 });
}
