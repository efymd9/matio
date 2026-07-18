import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { users, visitorDays, visitors } from "@/db/schema";
import { isValidAid, VISITOR_COOKIE } from "@/lib/visitor-cookie";

// ---------------------------------------------------------------------------
// First-party visit ledger writers. Everything here is analytics-only and
// best-effort by contract: callers sit on hot paths (beacon route, watch
// page render, signup-wall mount) and a failed write must never surface.
// ---------------------------------------------------------------------------

const REFERRER_MAX_LEN = 300;
const PATH_MAX_LEN = 200;

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function normalizeCountry(value: string | null | undefined): string | null {
  if (!value) return null;
  const c = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

export type VisitorDayFlags = {
  landedHome?: boolean;
  showViewed?: boolean;
  wallSeen?: boolean;
};

export type FirstVisitMeta = {
  firstPath?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  country?: string | null;
};

// Upserts the visitors row and folds the day's flags into the (aid, day)
// ledger row. First-visit meta is write-once PER COLUMN (COALESCE keeps any
// existing value, fills NULLs): the wall stamp and the beacon race on a
// fresh aid's very first page — SignupWall's server action often lands
// before the layout beacon — and a plain do-nothing insert would let the
// meta-less wall write permanently NULL the UTM/referrer columns for
// exactly the ad-sourced cohort the dashboard slices by. Flags are
// monotonic within a day: false → true, never back.
export async function recordVisitorDay(
  aid: string,
  flags: VisitorDayFlags,
  meta: FirstVisitMeta = {},
): Promise<void> {
  if (!isValidAid(aid)) return;
  await db
    .insert(visitors)
    .values({
      aid,
      firstPath: meta.firstPath?.slice(0, PATH_MAX_LEN) ?? null,
      referrer: meta.referrer?.slice(0, REFERRER_MAX_LEN) || null,
      utmSource: meta.utmSource ?? null,
      utmMedium: meta.utmMedium ?? null,
      utmCampaign: meta.utmCampaign ?? null,
      country: normalizeCountry(meta.country),
    })
    .onConflictDoUpdate({
      target: visitors.aid,
      set: {
        firstPath: sql`COALESCE(${visitors.firstPath}, excluded.first_path)`,
        referrer: sql`COALESCE(${visitors.referrer}, excluded.referrer)`,
        utmSource: sql`COALESCE(${visitors.utmSource}, excluded.utm_source)`,
        utmMedium: sql`COALESCE(${visitors.utmMedium}, excluded.utm_medium)`,
        utmCampaign: sql`COALESCE(${visitors.utmCampaign}, excluded.utm_campaign)`,
        country: sql`COALESCE(${visitors.country}, excluded.country)`,
      },
    });

  await db
    .insert(visitorDays)
    .values({
      aid,
      day: utcDay(),
      landedHome: flags.landedHome ?? false,
      showViewed: flags.showViewed ?? false,
      wallSeen: flags.wallSeen ?? false,
    })
    .onConflictDoUpdate({
      target: [visitorDays.aid, visitorDays.day],
      set: {
        landedHome: sql`${visitorDays.landedHome} OR excluded.landed_home`,
        showViewed: sql`${visitorDays.showViewed} OR excluded.show_viewed`,
        wallSeen: sql`${visitorDays.wallSeen} OR excluded.wall_seen`,
      },
    });
}

// Marks "hit the sign-up wall today" on the caller's own visit row. Reads
// the aid cookie itself so both stamp sites (SignupWall's server action and
// the token route's 403 branch) stay one-liners. Never throws.
export async function stampVisitorWallSeen(): Promise<void> {
  try {
    const aid = (await cookies()).get(VISITOR_COOKIE)?.value;
    if (!isValidAid(aid)) return;
    const country = (await headers()).get("x-vercel-ip-country");
    await recordVisitorDay(aid, { wallSeen: true }, { country });
  } catch {
    // analytics only
  }
}

// The merge the spec calls "склейка": attach the browser's anonymous visit
// history to the signed-in account, and stamp the account's country while
// we're here. First link wins — user_id is written only while NULL, so a
// shared browser can't re-assign one visitor's history to a second account
// (and the funnel's "registered" stage additionally requires the account to
// be YOUNGER than the visitor row, so old accounts signing in on a fresh
// browser never read as conversions). Runs on the signed-in watch render —
// the same surface that stamps UTM attribution — i.e. at worst a couple of
// tiny indexed no-op UPDATEs per page view. Never throws.
export async function linkVisitorToUser(userId: string): Promise<void> {
  try {
    const store = await cookies();
    const aid = store.get(VISITOR_COOKIE)?.value;
    let visitorCountry: string | null = null;
    if (isValidAid(aid)) {
      const [row] = await db
        .update(visitors)
        .set({ userId, linkedAt: new Date() })
        .where(and(eq(visitors.aid, aid), isNull(visitors.userId)))
        .returning({ country: visitors.country });
      visitorCountry =
        row?.country ??
        // Already linked earlier (returning visitor) — reuse its stored
        // country for the user stamp below without a second write.
        (
          await db
            .select({ country: visitors.country })
            .from(visitors)
            .where(and(eq(visitors.aid, aid), eq(visitors.userId, userId)))
            .limit(1)
        )[0]?.country ??
        null;
    }
    const country =
      visitorCountry ??
      normalizeCountry((await headers()).get("x-vercel-ip-country"));
    if (country) {
      await db
        .update(users)
        .set({ country })
        .where(and(eq(users.id, userId), isNull(users.country)));
    }
  } catch {
    // analytics only — never break the page that called us
  }
}
