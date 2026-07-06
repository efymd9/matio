"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { marketingLinks, shows } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import {
  canonicalizeTargetPath,
  canonicalizeUtmTriple,
  isValidTargetPath,
} from "@/lib/tracked-links";

// Validation failures return typed codes (mapped to localized copy in the
// client form) instead of the admin panel's usual throw-to-error-boundary —
// a mistyped campaign name shouldn't blow away the whole page.
export type CreateLinkState =
  | { status: "idle" }
  | { status: "ok" }
  | {
      status: "error";
      code:
        | "name_required"
        | "target_invalid"
        | "utm_required"
        | "duplicate"
        | "show_not_found"
        | "unknown";
    };

export async function createMarketingLink(
  _prev: CreateLinkState,
  formData: FormData,
): Promise<CreateLinkState> {
  const admin = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120) {
    return { status: "error", code: "name_required" };
  }

  // Target resolution. The form sends either a fixed kind ("home"/"custom")
  // or a "watch:<slug>" / "show:<slug>" pair — the slug is re-verified here
  // (the form sends it; the DB decides).
  const target = String(formData.get("target") ?? "");
  let targetPath: string;
  if (target === "home") {
    targetPath = "/";
  } else if (target === "custom") {
    targetPath = canonicalizeTargetPath(String(formData.get("customPath") ?? ""));
    if (!isValidTargetPath(targetPath)) {
      return { status: "error", code: "target_invalid" };
    }
  } else if (target.startsWith("watch:") || target.startsWith("show:")) {
    const slug = target.slice(target.indexOf(":") + 1);
    const [row] = await db
      .select({ slug: shows.slug })
      .from(shows)
      .where(and(eq(shows.slug, slug), isNull(shows.deletedAt)))
      .limit(1);
    if (!row) return { status: "error", code: "show_not_found" };
    targetPath = target.startsWith("watch:")
      ? `/watch/${row.slug}`
      : `/shows/${row.slug}`;
  } else {
    return { status: "error", code: "target_invalid" };
  }

  // Canonicalize exactly as the attribution pipeline would — the stored
  // triple must be byte-identical to what a visitor's session gets stamped
  // with, or the link's stats never match (lib/tracked-links.ts).
  const sourceRaw = String(formData.get("source") ?? "");
  const triple = canonicalizeUtmTriple({
    source:
      sourceRaw === "custom"
        ? String(formData.get("customSource") ?? "")
        : sourceRaw,
    medium: String(formData.get("medium") ?? ""),
    campaign: String(formData.get("campaign") ?? ""),
  });
  if (!triple.source || !triple.medium || !triple.campaign) {
    return { status: "error", code: "utm_required" };
  }

  // Friendly pre-check; the partial unique index is the real guarantee
  // under concurrent submits.
  const [dupe] = await db
    .select({ id: marketingLinks.id })
    .from(marketingLinks)
    .where(
      and(
        eq(marketingLinks.utmSource, triple.source),
        eq(marketingLinks.utmMedium, triple.medium),
        eq(marketingLinks.utmCampaign, triple.campaign),
        isNull(marketingLinks.archivedAt),
      ),
    )
    .limit(1);
  if (dupe) return { status: "error", code: "duplicate" };

  try {
    await db.insert(marketingLinks).values({
      name,
      targetPath,
      utmSource: triple.source,
      utmMedium: triple.medium,
      utmCampaign: triple.campaign,
      createdBy: admin.id,
    });
  } catch (e) {
    // 23505 = the unique index caught a concurrent duplicate.
    if ((e as { code?: string }).code === "23505") {
      return { status: "error", code: "duplicate" };
    }
    console.error("createMarketingLink failed", e);
    return { status: "error", code: "unknown" };
  }

  revalidatePath("/admin/links");
  revalidatePath("/admin/analytics");
  return { status: "ok" };
}

export async function archiveMarketingLink(linkId: string) {
  await requireAdmin();
  await db
    .update(marketingLinks)
    .set({ archivedAt: new Date() })
    .where(and(eq(marketingLinks.id, linkId), isNull(marketingLinks.archivedAt)));
  revalidatePath("/admin/links");
  revalidatePath("/admin/analytics");
}
