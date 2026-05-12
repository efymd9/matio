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
  };

  const [created] = await db.insert(shows).values(values).returning({ id: shows.id });

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
    })
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)));

  revalidatePath("/admin");
  revalidatePath(`/admin/shows/${id}`);
}

export async function softDeleteShow(id: string) {
  await requireAdmin();

  await db
    .update(shows)
    .set({ deletedAt: new Date() })
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)));

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
  await db.delete(seasons).where(eq(seasons.id, id));
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

  await db
    .update(episodes)
    .set({
      title,
      description: str(formData, "description") || null,
      number,
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

  const upload = await getMux().video.uploads.create({
    cors_origin: "*",
    new_asset_settings: {
      // Signed playback IDs enforce the JWT issued by /api/playback-token.
      // Existing public assets still play without one — they'd need to be
      // re-uploaded (or have signed playback IDs added via the Mux API).
      playback_policies: ["signed"],
      passthrough: episodeId,
    },
  });

  // Mark the episode as processing — covers fresh uploads and re-uploads
  // (e.g. after a previous upload errored).
  await db
    .update(episodes)
    .set({
      status: "processing",
      muxAssetId: null,
      muxPlaybackId: null,
      durationSeconds: null,
    })
    .where(eq(episodes.id, episodeId));

  if (!upload.url) throw new Error("Mux did not return an upload URL");

  return { uploadUrl: upload.url, uploadId: upload.id };
}
