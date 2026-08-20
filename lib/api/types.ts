// Wire types for the mobile app's /api/v1 surface.
//
// Deliberately UNIVERSAL — no `server-only`, no `next/*`, no drizzle imports.
// This module is the first thing that moves into packages/shared when the Expo
// app lands, so the app can import these exact types to type its fetch layer
// instead of hand-maintaining a second copy (the same drift argument that made
// lib/tracked-links.ts a shared contract).
//
// EVERY field below is a PUBLIC CONTRACT. Once a store build ships against it,
// removing or retyping a field breaks installed clients that keep running for
// months — the web's "just deploy the fix" escape hatch does not exist here.
// Adding optional fields is always safe; changing or removing one is not.
// The release valve for a genuinely breaking change is AppConfig.minSupportedBuild.

export const API_VERSION = 1;

// ---------------------------------------------------------------- errors

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "upgrade_required"
  | "server_error";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    // Machine-readable sub-reason, mirroring the web playback-token route's
    // `reason` field ("signup_required" | "subscribe_required") so the client
    // can route to the right wall without string-matching `message`.
    reason?: string;
  };
};

// ---------------------------------------------------------------- config

// How the app should gate playback for anonymous users.
//   tiers          — payments are ON; each episode's own `access` governs
//   none           — open free mode; anonymous users watch everything
//   after_episodes — free until N episodes are finished, then the sign-up wall
//
// `after_episodes` is the app's deliberate softening of the web's hard
// REQUIRE_SIGNUP gate: App Store guideline 5.1.1(v) expects an app to be
// usable before registration, and finishing episode 1 is already Matio's
// measured "hooked viewer" signal (the Meta Lead remap of 2026-07-19).
export type SignupGate =
  | { mode: "tiers" }
  | { mode: "none" }
  | { mode: "after_episodes"; episodes: number };

export type AppConfig = {
  apiVersion: number;
  // Builds below this must hard-block with an "update required" screen. This
  // is the ONLY lever that retires a broken client, so the app must honour it
  // from its very first release — retrofitting it later cannot reach the
  // builds that need it.
  minSupportedBuild: number;
  // Newest build in the stores; the app may show a soft "update available".
  latestBuild: number;
  flags: {
    paymentsEnabled: boolean;
    downloadsEnabled: boolean;
    castEnabled: boolean;
  };
  signupGate: SignupGate;
  locales: readonly string[];
  urls: {
    web: string;
    terms: string;
    privacy: string;
    cookies: string;
    support: string;
  };
};

// ---------------------------------------------------------------- catalog

export type ShowOrientation = "horizontal" | "vertical";
export type EpisodeAccessTier = "free" | "member" | "subscriber";

export type ShowSummary = {
  id: string;
  slug: string;
  title: string;
  synopsis: string | null;
  genre: string[];
  orientation: ShowOrientation;
  posterImageUrl: string | null;
  heroImageUrl: string | null;
  episodeCount: number;
  // Home-screen rail membership, mirroring the web home page's sections.
  featured: boolean;
  justReleased: boolean;
  popularNow: boolean;
};

export type EpisodeSummary = {
  id: string;
  seasonNumber: number;
  number: number;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  // The episode's configured tier. This is the RAW value — it is not coerced
  // for free mode or the signup gate. The client derives what to present from
  // AppConfig.signupGate, and /v1/playback-token remains the enforcement
  // point. Keeping these endpoints auth-independent is what lets them be
  // cached and shared between anonymous and signed-in callers.
  access: EpisodeAccessTier;
  releasedAt: string | null;
  // Signed Mux thumbnail URL. Carries a `t`-audience JWT that cannot be used
  // for video playback, and expires — see THUMBNAIL_TTL_SECONDS in the route.
  // Never cache a response containing these longer than that TTL.
  thumbnailUrl: string | null;
  // "Skip intro" window; both null when unset for this episode.
  introStartSeconds: number | null;
  introEndSeconds: number | null;
};

export type ShowDetail = ShowSummary & {
  // Ready episodes only, ordered by (season, episode). Position in this array
  // + 1 is the episode's depth for funnel purposes, matching the web's
  // getOrderedReadyEpisodeIds ordering.
  episodes: EpisodeSummary[];
};

export type CatalogResponse = {
  shows: ShowSummary[];
};

// ---------------------------------------------------------------- playback

export type PlaybackTokenRequest = {
  episodeId: string;
};

// `mode` mirrors the web token route's vocabulary exactly so the two surfaces
// stay describable in one sentence: subscriber (1h, auto-refreshing), member
// (signed-in, free mode), free (open), trial (legacy 60s preview, paid mode
// only — capped to the row's remaining time).
export type PlaybackMode = "subscriber" | "member" | "free" | "trial";

export type PlaybackTokenResponse = {
  // Mux playback ID and signed JWT. The app builds
  // https://stream.mux.com/<playbackId>.m3u8?token=<token>
  playbackId: string;
  token: string;
  expiresIn: number;
  mode: PlaybackMode;
};

// Returned in ApiErrorBody.reason on a 403, same values the web player routes
// on: "signup_required" → sign-up wall, "subscribe_required" → paywall.
export type PlaybackDenialReason = "signup_required" | "subscribe_required";

// Whether an episode is playable for the current viewer WITHOUT asking the
// server — derived client-side from AppConfig.signupGate plus the episode's
// position and tier. The app must lock prop-driven rather than relying on a
// token 403: the free-pivot bug was exactly a client that played on regardless
// because only the token route had been coerced.
export function isEpisodeLockedForApp(args: {
  gate: SignupGate;
  signedIn: boolean;
  hasSubscription: boolean;
  // 1-based position among the show's ready episodes.
  position: number;
  access: EpisodeAccessTier;
}): false | PlaybackDenialReason {
  const { gate, signedIn, hasSubscription, position, access } = args;

  if (gate.mode === "tiers") {
    if (access === "free") return false;
    if (access === "member") return signedIn ? false : "signup_required";
    return hasSubscription ? false : "subscribe_required";
  }

  if (gate.mode === "none") return false;

  // after_episodes: the first N of each show are open to anonymous viewers.
  if (signedIn) return false;
  return position <= gate.episodes ? false : "signup_required";
}
