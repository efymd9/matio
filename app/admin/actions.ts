"use server";

import { del } from "@vercel/blob";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  actors,
  episodeAccess,
  episodes,
  seasons,
  showActors,
  shows,
  type EpisodeAccess,
  type NewActor,
  type NewShow,
} from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { CATALOG_TAG } from "@/lib/catalog";
import { getMux } from "@/lib/mux";

// Bust the home/sitemap catalog cache (lib/catalog.ts:getPublishedShows).
// Called after any show mutation that can change which rows have
// status='published' AND deleted_at IS NULL. The second arg to
// revalidateTag is the cache-life profile to recompute under — since
// unstable_cache sets its own TTL, "default" is the no-op pick.
function bustCatalog() {
  revalidateTag(CATALOG_TAG, "default");
}

// Vercel Blob public host — admin-uploaded poster/hero artwork lives here.
// Legacy /shows/*.png (same-origin) and any external URL are NOT on it.
const BLOB_HOST_RE = /\.public\.blob\.vercel-storage\.com$/;

// When artwork is replaced or cleared, delete the previous Blob object so it
// doesn't linger and bill forever — uploads use addRandomSuffix, so a new
// upload never overwrites the old one and they'd otherwise accumulate. Only
// touches our own Blob host; best-effort and never throws, so a Blob outage
// or an unprovisioned store can't fail the save. (Uploads the admin started
// but never saved can't be reached this way — accept those, or reconcile
// later with a list() job.)
async function deleteOrphanedBlob(
  oldUrl: string | null,
  newUrl: string | null,
) {
  if (!oldUrl || oldUrl === newUrl) return;
  let host: string;
  try {
    host = new URL(oldUrl).hostname;
  } catch {
    return; // relative/legacy path — not a Blob object we own
  }
  if (!BLOB_HOST_RE.test(host)) return;
  try {
    await del(oldUrl);
  } catch {
    // Orphan cleanup is best-effort — never block the save on it.
  }
}

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
  const orientation =
    str(formData, "orientation") === "vertical" ? "vertical" : "horizontal";

  const values: NewShow = {
    title,
    slug,
    description: str(formData, "description") || null,
    posterImageUrl: str(formData, "posterImageUrl") || null,
    heroImageUrl: str(formData, "heroImageUrl") || null,
    genre: parseGenre(formData),
    status,
    orientation,
    justReleased: checkbox(formData, "justReleased"),
    popularNow: checkbox(formData, "popularNow"),
  };

  const [created] = await db.insert(shows).values(values).returning({ id: shows.id });

  revalidatePath("/");
  bustCatalog();
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
  const orientation =
    str(formData, "orientation") === "vertical" ? "vertical" : "horizontal";

  const posterImageUrl = str(formData, "posterImageUrl") || null;
  const heroImageUrl = str(formData, "heroImageUrl") || null;

  // Snapshot the current artwork so we can clean up any Blob object that's
  // being replaced or cleared by this edit (see deleteOrphanedBlob).
  const [prev] = await db
    .select({
      posterImageUrl: shows.posterImageUrl,
      heroImageUrl: shows.heroImageUrl,
    })
    .from(shows)
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)))
    .limit(1);

  await db
    .update(shows)
    .set({
      title,
      slug,
      description: str(formData, "description") || null,
      posterImageUrl,
      heroImageUrl,
      genre: parseGenre(formData),
      status,
      orientation,
      justReleased: checkbox(formData, "justReleased"),
      popularNow: checkbox(formData, "popularNow"),
    })
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)));

  // After the row is safely updated, drop any now-unreferenced Blob artwork.
  if (prev) {
    await deleteOrphanedBlob(prev.posterImageUrl, posterImageUrl);
    await deleteOrphanedBlob(prev.heroImageUrl, heroImageUrl);
  }

  revalidatePath("/");
  bustCatalog();
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
  bustCatalog();
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
  bustCatalog();
  revalidatePath("/admin");
  revalidatePath(`/admin/shows/${id}`);
}

export async function softDeleteShow(id: string) {
  await requireAdmin();

  await db
    .update(shows)
    // Clear status alongside deletedAt so a soft-deleted show is never left as
    // status='published' — keeps the catalog / analytics filters unambiguous.
    .set({ deletedAt: new Date(), status: "draft" })
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)));

  revalidatePath("/");
  bustCatalog();
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

  // Per-episode access tier — the form's AccessFormSelect always submits
  // one of the enum values; anything else is a forged post.
  const accessRaw = str(formData, "access");
  if (!(episodeAccess.enumValues as readonly string[]).includes(accessRaw)) {
    throw new Error("Invalid access tier");
  }
  const access = accessRaw as EpisodeAccess;

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
      access,
      introStartSeconds: introStartFinal,
      introEndSeconds: introEndFinal,
    })
    .where(eq(episodes.id, id));

  revalidatePath(`/admin/shows/${showId}/seasons/${seasonId}/episodes/${id}`);
  revalidatePath(`/admin/shows/${showId}/seasons/${seasonId}`);
}

// Instant per-episode access change from the season page's row select.
// Validated against the enum (the client passes a string), chain-verified
// like deleteEpisode so crafted calls can't reach across shows.
export async function updateEpisodeAccess(
  episodeId: string,
  seasonId: string,
  showId: string,
  access: EpisodeAccess,
) {
  await requireAdmin();
  if (!episodeAccess.enumValues.includes(access)) {
    throw new Error("Invalid access tier");
  }
  const [chain] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.seasonId, seasonId),
        eq(seasons.showId, showId),
      ),
    )
    .limit(1);
  if (!chain) throw new Error("Episode not in this season/show");

  await db.update(episodes).set({ access }).where(eq(episodes.id, episodeId));

  revalidatePath(`/admin/shows/${showId}/seasons/${seasonId}`);
  revalidatePath(
    `/admin/shows/${showId}/seasons/${seasonId}/episodes/${episodeId}`,
  );
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

// ---------- virtual actors ----------

// Shared validation for the create/update actor forms. Returns the column
// values; throws on a bad name/slug — same fail-loud style as the show
// actions (messages are masked in prod anyway).
function actorValues(formData: FormData): NewActor {
  const name = str(formData, "name");
  const slug = str(formData, "slug");
  if (!name) throw new Error("Name is required");
  if (!slug) throw new Error("Slug is required");
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Slug must be lowercase letters, numbers, and hyphens");
  }
  return {
    name,
    slug,
    tagline: str(formData, "tagline") || null,
    bio: str(formData, "bio") || null,
    avatarImageUrl: str(formData, "avatarImageUrl") || null,
  };
}

export async function createActor(formData: FormData) {
  await requireAdmin();
  const [created] = await db
    .insert(actors)
    .values(actorValues(formData))
    .returning({ id: actors.id });
  revalidatePath("/admin/actors");
  redirect(`/admin/actors/${created.id}`);
}

export async function updateActor(id: string, formData: FormData) {
  await requireAdmin();
  const values = actorValues(formData);

  // Snapshot the current avatar so a replaced/cleared Blob object gets
  // cleaned up, same as show artwork.
  const [prev] = await db
    .select({ avatarImageUrl: actors.avatarImageUrl })
    .from(actors)
    .where(eq(actors.id, id))
    .limit(1);

  await db.update(actors).set(values).where(eq(actors.id, id));

  if (prev) {
    await deleteOrphanedBlob(prev.avatarImageUrl, values.avatarImageUrl ?? null);
  }

  revalidatePath("/admin/actors");
  revalidatePath(`/admin/actors/${id}`);
}

// Hard delete (unlike shows' soft delete): an actor carries no playback or
// billing state, and the show_actors FK cascades, so the row disappears
// from every show's cast in the same statement.
export async function deleteActor(id: string) {
  await requireAdmin();
  const [prev] = await db
    .select({ avatarImageUrl: actors.avatarImageUrl })
    .from(actors)
    .where(eq(actors.id, id))
    .limit(1);

  await db.delete(actors).where(eq(actors.id, id));

  if (prev) await deleteOrphanedBlob(prev.avatarImageUrl, null);

  revalidatePath("/admin/actors");
  redirect("/admin/actors");
}

// ---------- show cast (show_actors) ----------

export async function addActorToShow(showId: string, formData: FormData) {
  await requireAdmin();

  const actorId = str(formData, "actorId");
  if (!actorId) throw new Error("Pick an actor to add");

  // Verify both sides exist (the actor select is admin-rendered, but the
  // server can't trust a form post) before linking.
  const [actor] = await db
    .select({ id: actors.id })
    .from(actors)
    .where(eq(actors.id, actorId))
    .limit(1);
  if (!actor) throw new Error("Actor not found");
  const [show] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.id, showId), isNull(shows.deletedAt)))
    .limit(1);
  if (!show) throw new Error("Show not found");

  // Append at the end of the current order. max(position)+1 computed in
  // the insert itself so two quick adds can't race to the same slot in a
  // way that breaks anything worse than a tied position (ties are stable:
  // the cast query orders by (position, name)).
  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${showActors.position}), 0) + 1`,
    })
    .from(showActors)
    .where(eq(showActors.showId, showId));

  await db
    .insert(showActors)
    .values({
      showId,
      actorId,
      characterName: str(formData, "characterName") || null,
      position: next,
    })
    // Already in the cast → keep the existing row (and its character name).
    .onConflictDoNothing();

  revalidatePath(`/admin/shows/${showId}`);
}

export async function updateCastCharacter(
  showId: string,
  actorId: string,
  formData: FormData,
) {
  await requireAdmin();
  await db
    .update(showActors)
    .set({ characterName: str(formData, "characterName") || null })
    .where(
      and(eq(showActors.showId, showId), eq(showActors.actorId, actorId)),
    );
  revalidatePath(`/admin/shows/${showId}`);
}

export async function removeActorFromShow(showId: string, actorId: string) {
  await requireAdmin();
  await db
    .delete(showActors)
    .where(
      and(eq(showActors.showId, showId), eq(showActors.actorId, actorId)),
    );
  revalidatePath(`/admin/shows/${showId}`);
}

// Swap the row with its neighbour in display order. Rewrites BOTH rows'
// positions to dense ranks inside one transaction, so legacy ties/gaps
// self-heal as rows get moved.
export async function moveCastMember(
  showId: string,
  actorId: string,
  direction: "up" | "down",
) {
  await requireAdmin();
  await db.transaction(async (tx) => {
    const cast = await tx
      .select({ actorId: showActors.actorId })
      .from(showActors)
      .innerJoin(actors, eq(showActors.actorId, actors.id))
      .where(eq(showActors.showId, showId))
      .orderBy(asc(showActors.position), asc(actors.name));

    const from = cast.findIndex((c) => c.actorId === actorId);
    if (from === -1) return;
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= cast.length) return;

    const order = cast.map((c) => c.actorId);
    [order[from], order[to]] = [order[to], order[from]];

    for (let i = 0; i < order.length; i++) {
      await tx
        .update(showActors)
        .set({ position: i + 1 })
        .where(
          and(
            eq(showActors.showId, showId),
            eq(showActors.actorId, order[i]),
          ),
        );
    }
  });
  revalidatePath(`/admin/shows/${showId}`);
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
