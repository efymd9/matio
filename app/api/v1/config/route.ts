import type { AppConfig } from "@/lib/api/types";
import { API_VERSION } from "@/lib/api/types";
import { apiOk, envInt, resolveSignupGate } from "@/lib/api/v1";
import { paymentsEnabled } from "@/lib/free-mode";
import { SITE_URL } from "@/lib/seo";

// GET /api/v1/config — the app's startup call.
//
// Every launch hits this before anything else, so it must be cheap (no DB) and
// must never fail closed. It carries the two things a shipped binary cannot
// change about itself: the kill-switch state, and whether this build is still
// allowed to run.
//
// APP_MIN_SUPPORTED_BUILD is the single lever that retires a broken client.
// It is read at request time (not build time) so raising it is an env change
// + redeploy, with no store round-trip — the same bind-at-deploy semantics as
// PAYMENTS_ENABLED / REQUIRE_SIGNUP.
//
// The signup gate reported here is resolved by the SAME function that
// /v1/playback-token enforces (lib/api/v1.ts:resolveSignupGate) — see the note
// there on why those can never be allowed to drift apart.

export const runtime = "nodejs";

// Recomputed per request: the flags are runtime env reads, and a cached
// response would strand the app on a stale kill-switch.
export const dynamic = "force-dynamic";

export async function GET() {
  const config: AppConfig = {
    apiVersion: API_VERSION,
    minSupportedBuild: envInt("APP_MIN_SUPPORTED_BUILD", 1),
    latestBuild: envInt("APP_LATEST_BUILD", 1),
    flags: {
      paymentsEnabled: paymentsEnabled(),
      // Downloads stay off until the Mux plan supports static renditions —
      // shipping the UI before the backend can serve a file would put a dead
      // button in a released binary.
      downloadsEnabled: process.env.APP_DOWNLOADS_ENABLED === "1",
      castEnabled: process.env.APP_CAST_ENABLED === "1",
    },
    signupGate: resolveSignupGate(),
    locales: ["en", "es"],
    urls: {
      web: SITE_URL,
      terms: `${SITE_URL}/terms`,
      privacy: `${SITE_URL}/privacy`,
      cookies: `${SITE_URL}/cookies`,
      support: "mailto:contact@matio.tv",
    },
  };

  return apiOk(config);
}
