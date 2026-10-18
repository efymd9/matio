import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import { readAttributionCookiesFromRequest } from "@/lib/attribution";
import { resolveRequestTier } from "@/lib/episode-access";
import { paymentsEnabled, signupRequired } from "@/lib/free-mode";
import { signMuxPlaybackToken } from "@/lib/mux-token";
import { hasActiveSubscription } from "@/lib/subscription-access";
import { stampVisitorWallSeen } from "@/lib/visitor";
import {
  TRIAL_COOKIE,
  TrialRateLimitError,
  findTrialSession,
  getClientIp,
  hashClientIp,
  mintTrialSession,
  stampSignupWall,
} from "@/lib/trial";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const runtime = "nodejs";

const SUBSCRIBER_TTL = 60 * 60; // 1h
const NO_CACHE = { "Cache-Control": "private, no-store" } as const;
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// Structured, greppable log so token volume + outcome (esp. a 403 spike that
// would flag a client refresh-loop regression) is queryable in Vercel runtime
// logs — the route was previously silent on success, which is why the
// original refresh-loop bug was invisible to monitoring.
function logToken(fields: {
  result: number;
  mode: "subscriber" | "free" | "member" | "none";
  showId?: string;
  episodeId?: string | null;
}) {
  console.info(`[playback-token] ${JSON.stringify(fields)}`);
}

export async function GET(req: NextRequest) {
  const episodeId = req.nextUrl.searchParams.get("episode_id");
  // Shape-checked before it reaches the query or a log line (#305): a
  // non-uuid makes the driver throw with the statement AND its params, so
  // whatever the client put in the URL would land in the runtime log. The
  // player only ever sends database ids; the app's twin guards the same way.
  if (!episodeId || !UUID_RE.test(episodeId)) {
    logToken({ result: 400, mode: "none" });
    return NextResponse.json(
      { error: "Missing or invalid episode_id" },
      { status: 400, headers: NO_CACHE },
    );
  }

  // Belt-and-braces gate: episode must be ready, show must be published and
  // not soft-deleted. Without this, anyone with a leaked draft episode id
  // could mint a token for unreleased content (a free-tier one needs no
  // account at all). The watch page applies the same filters at render time,
  // but this endpoint is the actual token-issuance gate.
  const [row] = await db
    .select({
      playbackId: episodes.muxPlaybackId,
      showId: seasons.showId,
      access: episodes.access,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.status, "ready"),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .limit(1);

  if (!row || !row.playbackId) {
    logToken({ result: 404, mode: "none", episodeId });
    return NextResponse.json(
      { error: "Episode not found or not ready" },
      { status: 404, headers: NO_CACHE },
    );
  }

  // Subscriber path. The access-granting set + current_period_end check
  // both live in hasActiveSubscription() — past_due users (whose latest
  // invoice failed and is being retried) keep playback, but a row whose
  // current_period_end already passed (e.g. a dropped
  // customer.subscription.deleted webhook left it as "active" forever)
  // is treated as unsubscribed.
  const { userId } = await auth();
  if (userId && (await hasActiveSubscription(userId))) {
    const token = signMuxPlaybackToken(row.playbackId, SUBSCRIBER_TTL);
    logToken({ result: 200, mode: "subscriber", showId: row.showId, episodeId });
    return NextResponse.json({
      token,
      expiresIn: SUBSCRIBER_TTL,
      mode: "subscriber",
    }, { headers: NO_CACHE });
  }

  // Per-episode access control: the episode's own `access` value decides
  // who may play it — free → anyone, member → any signed-in user,
  // subscriber → active subscription (subscribers already returned above).
  // Every 403 carries a machine-readable `reason` the player routes on.
  //
  // Registration first, then the paywall (#462): an ANONYMOUS request for a
  // subscriber episode resolves to the member tier, i.e. 403
  // `signup_required` — the sign-up wall; once signed in, the same episode
  // answers `subscribe_required` — the paywall. There is no 60-second preview
  // any more, for anyone: no request through here mints a kind='preview' row.
  //
  // Free pivot: with payments off, tiers aren't enforced — signed-in
  // viewers take the member path, anonymous viewers the free path (which
  // keeps the anonymous funnel tracking + its best-effort rate-limit
  // semantics). Both existing branches already never 403 for their
  // audience, so the paywall/signup paths below become unreachable.
  //
  // Signup gate (REQUIRE_SIGNUP=1, free mode only): the episode's own tier
  // decides for anonymous requests (resolveEffectiveTier) — a free episode
  // mints as before, member and subscriber land on the 403
  // `signup_required` branch below. Belt-and-braces behind the watch page's
  // presentation (the player never fetches for a locked episode; this
  // catches direct/scripted requests).
  // Signed-in viewers under the gate take the member path (they play
  // everything for free); anonymous ones get the episode's own effective
  // tier, so a free episode still mints and anything above it 403s.
  const access = resolveRequestTier(row.access, {
    paymentsOn: paymentsEnabled(),
    signupGate: signupRequired(),
    signedIn: Boolean(userId),
  });

  if (access === "free") {
    // Funnel tracking row (kind='episodes') — minted on the first free
    // play for this (cookie, show), carrying the attribution snapshot and
    // the IP hash. STRICTLY best-effort: a rate
    // limit (or any DB hiccup) degrades tracking, never playback — free
    // content must not 429.
    const cookieStore = await cookies();
    const existingToken = cookieStore.get(TRIAL_COOKIE)?.value;
    const sessionToken = existingToken ?? crypto.randomUUID();
    let setCookie = false;
    try {
      const existing = existingToken
        ? await findTrialSession(existingToken, row.showId)
        : null;
      if (!existing) {
        await mintTrialSession({
          sessionToken,
          showId: row.showId,
          ipHash: hashClientIp(getClientIp(req)),
          client: "web",
          attribution: readAttributionCookiesFromRequest(req),
          kind: "episodes",
        });
        setCookie = !existingToken;
      }
    } catch (err) {
      // TrialRateLimitError or transient DB failure — tracking skipped,
      // playback unaffected. Warn on the unexpected case so a systemic DB
      // failure can't silently zero the funnel (rate limits are normal
      // abuse-control noise, not failures). Ids only: the driver's message
      // quotes the failed statement WITH its params — the trial cookie and
      // the IP hash (#305).
      if (!(err instanceof TrialRateLimitError)) {
        console.warn(
          `[playback-token] free-tier tracking skipped ${JSON.stringify({
            showId: row.showId,
            episodeId,
          })}`,
        );
      }
    }
    const token = signMuxPlaybackToken(row.playbackId, SUBSCRIBER_TTL);
    logToken({ result: 200, mode: "free", showId: row.showId, episodeId });
    const res = NextResponse.json(
      { token, expiresIn: SUBSCRIBER_TTL, mode: "free" },
      { headers: NO_CACHE },
    );
    if (setCookie) {
      res.cookies.set(TRIAL_COOKIE, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: ONE_YEAR_SECONDS,
      });
    }
    return res;
  }

  if (access === "member") {
    if (userId) {
      const token = signMuxPlaybackToken(row.playbackId, SUBSCRIBER_TTL);
      logToken({
        result: 200,
        mode: "member",
        showId: row.showId,
        episodeId,
      });
      return NextResponse.json(
        { token, expiresIn: SUBSCRIBER_TTL, mode: "member" },
        { headers: NO_CACHE },
      );
    }
    // Anonymous request for a member episode → sign-up wall. Stamp the
    // funnel timestamp on the session's row when one exists (deep-link
    // path; the end-of-tier path stamps via markSignupWallShown).
    const cookieStore = await cookies();
    const existingToken = cookieStore.get(TRIAL_COOKIE)?.value;
    if (existingToken) {
      try {
        await stampSignupWall(existingToken, row.showId);
      } catch {
        // analytics-only — never block the response. Ids only, same reason
        // as the free-tier tracking catch above.
        console.warn(
          `[playback-token] signup-wall stamp skipped ${JSON.stringify({
            showId: row.showId,
            episodeId,
          })}`,
        );
      }
    }
    // First-party visit ledger: mark "hit the sign-up wall today" on the
    // browser's own visit row (deep-link path; the end-of-tier path stamps
    // via markSignupWallShown). Reads its own cookie, never throws.
    await stampVisitorWallSeen();
    logToken({ result: 403, mode: "free", showId: row.showId, episodeId });
    return NextResponse.json(
      { error: "Not authorized", reason: "signup_required" },
      { status: 403, headers: NO_CACHE },
    );
  }

  // access === "subscriber" and the requester isn't one (subscribers
  // returned earlier, and an anonymous request resolved to "member" above):
  // a signed-in viewer without a subscription — the paywall. Every show,
  // all-subscriber ones included: the legacy 60-second preview that used to
  // follow here is gone (#462).
  logToken({ result: 403, mode: "member", showId: row.showId, episodeId });
  return NextResponse.json(
    { error: "Not authorized", reason: "subscribe_required" },
    { status: 403, headers: NO_CACHE },
  );
}
