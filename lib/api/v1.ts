import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { paymentsEnabled, signupRequired } from "@/lib/free-mode";
import { SITE_URL } from "@/lib/seo";
import type { ApiErrorBody, ApiErrorCode, SignupGate } from "./types";

// Server-side helpers for the /api/v1 mobile surface. The wire TYPES live in
// ./types.ts (universal, shared with the app); this module is the server half
// and must never be imported by a client bundle.

// The app's audience-measurement identifier — the native equivalent of the
// matio_aid cookie. proxy.ts:applyVisitorCookie deliberately early-returns on
// /api paths, so a native client can never receive that cookie; it mints its
// own UUID into expo-secure-store and sends it here on every call.
export const DEVICE_ID_HEADER = "x-matio-device-id";

// Native clients get the same no-store treatment as the web token route for
// anything auth- or identity-shaped. Public catalog reads override this.
export const API_NO_STORE = { "Cache-Control": "private, no-store" } as const;

const ERROR_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  upgrade_required: 426,
  server_error: 500,
};

export function apiOk<T>(
  body: T,
  init: { headers?: Record<string, string>; status?: number } = {},
): NextResponse {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: { ...API_NO_STORE, ...init.headers },
  });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  init: { reason?: string; headers?: Record<string, string> } = {},
): NextResponse {
  const body: ApiErrorBody = {
    error: { code, message, ...(init.reason ? { reason: init.reason } : {}) },
  };
  return NextResponse.json(body, {
    status: ERROR_STATUS[code],
    headers: { ...API_NO_STORE, ...init.headers },
  });
}

// Accepts only a canonical UUID. An unvalidated device id would become a
// primary key in the visit ledger, so garbage in the header must never reach
// the DB — callers treat null as "anonymous, untracked" rather than erroring,
// so a client bug degrades measurement instead of breaking playback (the same
// best-effort posture as the web free-tier tracking mint).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readDeviceId(req: NextRequest): string | null {
  const raw = req.headers.get(DEVICE_ID_HEADER);
  if (!raw || !UUID_RE.test(raw)) return null;
  return raw.toLowerCase();
}

// Show artwork predating the Vercel Blob migration is stored as a same-origin
// PATH ("/shows/cartero-mundo-poster.png"); newer rows hold absolute Blob URLs.
// next/image resolves both on the web, but a native client has no origin to
// resolve against — a relative URL reaches the app as an unloadable image.
// Every media URL crossing this boundary must be absolute.
export function absoluteMediaUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${SITE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

// The app's playback gate, resolved in ONE place.
//
// /v1/config reports this to the client so it can lock episodes prop-driven
// (with no token fetch), and /v1/playback-token enforces the identical rule
// server-side. These two must never disagree — the free-pivot lesson was that
// coercing only the token route leaves the client happily playing what the
// server would refuse, and coercing only the client leaves the server open.
//
// `after_episodes: N` means: the first N ready episodes OF EACH SHOW are open
// to anonymous viewers; anything deeper needs an account. Positional, matching
// how the web derives funnel depth (getOrderedReadyEpisodeIds).
export function resolveSignupGate(): SignupGate {
  // Paid mode: the per-episode tier system owns all gating, exactly as on the
  // web. No second flag matrix.
  if (paymentsEnabled()) return { mode: "tiers" };

  // Free mode + REQUIRE_SIGNUP: the web hard-gates ALL playback behind an
  // account. The app deliberately softens that — a hard login wall on first
  // launch is the most likely App Store 5.1.1(v) rejection trigger, and Matio's
  // own measurement says the hooked-viewer moment is finishing episode 1.
  // Tunable without a store release via APP_SIGNUP_GATE_EPISODES.
  if (signupRequired()) {
    return { mode: "after_episodes", episodes: envInt("APP_SIGNUP_GATE_EPISODES", 1) };
  }

  return { mode: "none" };
}

// Reads a positive integer env var, falling back when unset or malformed.
// Used for the build gates in /v1/config, which must never 500 the app's
// startup call just because an env var was fat-fingered.
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
