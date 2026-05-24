"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  episodes,
  seasons,
  shows,
  type NewShow,
} from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { getMux } from "@/lib/mux";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function num(formData: FormData, key: string): number | null {
  const v = formData.get(key);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseGenre(formData: FormData): string[] {
  const raw = str(formData, "genre");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// HTML checkboxes send the field with the literal string "on" when checked
// and omit the field entirely when unchecked. Both `has()` and `get() === "on"`
// work; `has()` is more permissive of custom values.
function checkbox(formData: FormData, key: string): boolean {
  return formData.has(key);
}

// ---------- shows ----------

export async function createShow(formData: FormData) {
  await requireAdmin();

  const title = str(formData, "title");
  const slug = str(formData, "slug");
  if (!title) throw new Error("Title is required");
  if (!slug) throw new Error("Slug is required");
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Slug must be lowercase letters, numbers, and hyphens");
  }

  const status = str(formData, "status") === "published" ? "published" : "draft";

  const values: NewShow = {
    title,
    slug,
    description: str(formData, "description") || null,
    posterImageUrl: str(formData, "posterImageUrl") || null,
    heroImageUrl: str(formData, "heroImageUrl") || null,
    genre: parseGenre(formData),
    status,
    justReleased: checkbox(formData, "justReleased"),
    popularNow: checkbox(formData, "popularNow"),
  };

  const [created] = await db.insert(shows).values(values).returning({ id: shows.id });

  revalidatePath("/");
  revalidatePath("/admin");
  redirect(`/admin/shows/${created.id}`);
}

export async function updateShow(id: string, formData: FormData) {
  await requireAdmin();

  const title = str(formData, "title");
  const slug = str(formData, "slug");
  if (!title) throw new Error("Title is required");
  if (!slug) throw new Error("Slug is required");
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Slug must be lowercase letters, numbers, and hyphens");
  }

  const status = str(formData, "status") === "published" ? "published" : "draft";

  await db
    .update(shows)
    .set({
      title,
      slug,
      description: str(formData, "description") || null,
      posterImageUrl: str(formData, "posterImageUrl") || null,
      heroImageUrl: str(formData, "heroImageUrl") || null,
      genre: parseGenre(formData),
      status,
      justReleased: checkbox(formData, "justReleased"),
      popularNow: checkbox(formData, "popularNow"),
    })
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)));

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/admin/shows/${id}`);
}

// Atomic "only one featured at a time": flips the target to true and
// every other row to false in a single transaction. Refuses to feature
// a draft or soft-deleted show — the public hero would render an
// invisible (404) link otherwise.
export async function setFeaturedShow(id: string) {
  await requireAdmin();
  await db.transaction(async (tx) => {
    await tx
      .update(shows)
      .set({ featured: false })
      .where(eq(shows.featured, true));
    await tx
      .update(shows)
      .set({ featured: true })
      .where(
        and(
          eq(shows.id, id),
          eq(shows.status, "published"),
          isNull(shows.deletedAt),
        ),
      );
  });
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/admin/shows/${id}`);
}

export async function unsetFeaturedShow(id: string) {
  await requireAdmin();
  await db
    .update(shows)
    .set({ featured: false })
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)));
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/admin/shows/${id}`);
}

export async function softDeleteShow(id: string) {
  await requireAdmin();

  await db
    .update(shows)
    .set({ deletedAt: new Date() })
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)));

  revalidatePath("/");
  revalidatePath("/admin");
  redirect("/admin");
}

// ---------- seasons ----------

export async function createSeason(showId: string, formData: FormData) {
  await requireAdmin();

  const number = num(formData, "number");
  if (number === null || number < 1) {
    throw new Error("Season number must be a positive integer");
  }

  await db.insert(seasons).values({
    showId,
    number,
    title: str(formData, "title") || null,
    description: str(formData, "description") || null,
  });

  revalidatePath(`/admin/shows/${showId}`);
}

export async function deleteSeason(id: string, showId: string) {
  await requireAdmin();
  // Scope the delete to (season_id, show_id) so a crafted form post
  // with mismatched ids can't reach across shows. The form sends both
  // ids; the relationship is enforced here.
  await db
    .delete(seasons)
    .where(and(eq(seasons.id, id), eq(seasons.showId, showId)));
  revalidatePath(`/admin/shows/${showId}`);
}

// ---------- episodes ----------

export async function createEpisode(
  seasonId: string,
  showId: string,
  formData: FormData,
) {
  await requireAdmin();

  const title = str(formData, "title");
  if (!title) throw new Error("Title is required");

  const number = num(formData, "number");
  if (number === null || number < 1) {
    throw new Error("Episode number must be a positive integer");
  }

  // Verify the (season, show) pair actually exists together. The form
  // sends both ids and we'd otherwise trust them blindly — a crafted
  // post could insert an episode under one show's season while
  // surfacing under another show's URL.
  const [season] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), eq(seasons.showId, showId)))
    .limit(1);
  if (!season) throw new Error("Season not found for this show");

  await db.insert(episodes).values({
    seasonId,
    number,
    title,
    description: str(formData, "description") || null,
  });

  revalidatePath(`/admin/shows/${showId}/seasons/${seasonId}`);
}

export async function updateEpisode(
  id: string,
  seasonId: string,
  showId: string,
  formData: FormData,
) {
  await requireAdmin();

  const title = str(formData, "title");
  if (!title) throw new Error("Title is required");

  const number = num(formData, "number");
  if (number === null || number < 1) {
    throw new Error("Episode number must be a positive integer");
  }

  // Intro markers — both optional. When set, they drive the player's
  // "Skip intro" chip. Validate the pair: either both are blank/null
  // (chip hidden) or end > start (chip seeks from start to end).
  const introStart = num(formData, "introStartSeconds");
  const introEnd = num(formData, "introEndSeconds");
  if (introStart !== null && (introStart < 0 || !Number.isInteger(introStart))) {
    throw new Error("Intro start must be a non-negative integer (seconds)");
  }
  if (introEnd !== null && (introEnd < 0 || !Number.isInteger(introEnd))) {
    throw new Error("Intro end must be a non-negative integer (seconds)");
  }
  if (introStart !== null && introEnd !== null && introEnd <= introStart) {
    throw new Error("Intro end must be after intro start");
  }
  // Partial set: blank one side → null both (skip chip needs both markers).
  const introStartFinal =
    introStart !== null && introEnd !== null ? introStart : null;
  const introEndFinal =
    introStart !== null && introEnd !== null ? introEnd : null;

  // Verify (episode, season, show) chain before mutating, same as the
  // delete path. The route only renders this form for matching ids, but
  // the server can't trust that.
  const [chain] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(episodes.id, id),
        eq(episodes.seasonId, seasonId),
        eq(seasons.showId, showId),
      ),
    )
    .limit(1);
  if (!chain) throw new Error("Episode not in this season/show");

  await db
    .update(episodes)
    .set({
      title,
      description: str(formData, "description") || null,
      number,
      introStartSeconds: introStartFinal,
      introEndSeconds: introEndFinal,
    })
    .where(eq(episodes.id, id));

  revalidatePath(`/admin/shows/${showId}/seasons/${seasonId}/episodes/${id}`);
  revalidatePath(`/admin/shows/${showId}/seasons/${seasonId}`);
}

export async function deleteEpisode(
  id: string,
  seasonId: string,
  showId: string,
) {
  await requireAdmin();
  // Verify the full (episode, season, show) chain before deleting.
  // Form posts could otherwise pass mismatched ids and reach across
  // unrelated shows.
  const [chain] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(episodes.id, id),
        eq(episodes.seasonId, seasonId),
        eq(seasons.showId, showId),
      ),
    )
    .limit(1);
  if (!chain) throw new Error("Episode not in this season/show");
  await db.delete(episodes).where(eq(episodes.id, id));
  revalidatePath(`/admin/shows/${showId}/seasons/${seasonId}`);
}

// ---------- Mux ----------

export async function createMuxUpload(
  episodeId: string,
): Promise<{ uploadUrl: string; uploadId: string }> {
  await requireAdmin();

  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (!episode) throw new Error("Episode not found");

  // Scope the upload URL's CORS to our origin so a leaked URL can't be used
  // from someone else's page. Falls back to `*` only in local dev where
  // NEXT_PUBLIC_APP_URL might not be set.
  const corsOrigin = process.env.NEXT_PUBLIC_APP_URL ?? "*";

  const upload = await getMux().video.uploads.create({
    cors_origin: corsOrigin,
    new_asset_settings: {
      // Signed playback IDs enforce the JWT issued by /api/playback-token.
      // Existing public assets still play without one — they'd need to be
      // re-uploaded (or have signed playback IDs added via the Mux API).
      playback_policies: ["signed"],
      passthrough: episodeId,
    },
  });

  if (!upload.url) throw new Error("Mux did not return an upload URL");

  // Deliberately do NOT clear playback fields or flip status here. If we
  // did and the admin closed the tab before the upload progressed, the
  // episode would be stuck in "processing" forever (the webhook's
  // resolveEpisodeFromPassthrough refuses to overwrite a different
  // existing asset_id — see app/api/webhooks/mux/route.ts). Clearing is
  // done by markEpisodeReprocessing after the browser → Mux upload
  // actually completes, bounding the broken window to the transcoding
  // duration only.
  return { uploadUrl: upload.url, uploadId: upload.id };
}

// Called by the admin upload widget once `@mux/upchunk` fires its
// `success` event — the upload has finished and Mux will (eventually)
// transcode. Clearing here, rather than inside createMuxUpload, makes
// cancelled uploads non-destructive: the previous asset stays live
// until the new one is genuinely on its way.
export async function markEpisodeReprocessing(episodeId: string) {
  await requireAdmin();
  await db
    .update(episodes)
    .set({
      status: "processing",
      muxAssetId: null,
      muxPlaybackId: null,
      muxPlaybackPolicy: null,
      durationSeconds: null,
    })
    .where(eq(episodes.id, episodeId));
}
