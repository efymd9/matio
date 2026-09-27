import type {
  ApiErrorBody,
  ApiErrorCode,
  AppConfig,
  CatalogResponse,
  ContinueResponse,
  DeleteAccountResponse,
  EpisodeProgressResponse,
  PlaybackTokenResponse,
  SaveProgressRequest,
  SaveProgressResponse,
  SaveWatchSegmentsRequest,
  SaveWatchSegmentsResponse,
  ShowDetail,
} from "@/shared/api-types";
import { getDeviceId } from "./device";

// Typed client for the /api/v1 surface.
//
// Base URL resolution: EXPO_PUBLIC_API_BASE_URL wins when set (needed for a
// PHYSICAL device, which cannot reach the Mac's localhost — use the LAN IP,
// e.g. http://192.168.1.20:3100). The dev default targets the local Next dev
// server; release builds target production.
const DEFAULT_BASE_URL = __DEV__ ? "http://localhost:3100" : "https://matio.tv";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_BASE_URL;

// Mobile networks stall rather than fail. Without a bound, a dead connection
// leaves the UI on a spinner forever.
const REQUEST_TIMEOUT_MS = 12_000;

// Account deletion is the one request whose server side waits on vendors in
// sequence — Stripe (cancel ≈17s at worst with its retries, then the customer
// search, 5s), PostHog (5s a request), then Clerk; each bounded, typically
// ~2s in all. 12s would abandon a deletion the server is still finishing and
// tell the viewer it failed. The route's own ceiling is 60s (maxDuration).
export const ACCOUNT_DELETE_TIMEOUT_MS = 45_000;

// Clerk's getToken() is a hook-bound function, but this module is plain and is
// imported by non-React code. The provider is injected once at startup by
// <AuthBridge> in app/_layout.tsx rather than threading auth through every
// call site.
type TokenProvider = () => Promise<string | null>;
let authTokenProvider: TokenProvider | null = null;

export function setAuthTokenProvider(provider: TokenProvider | null) {
  authTokenProvider = provider;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode | "network" | "malformed";
  readonly status: number;
  readonly reason?: string;

  constructor(
    code: ApiError["code"],
    message: string,
    status: number,
    reason?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.code === "string"
  );
}

// Header construction talks to the keychain and to Clerk, and BOTH can hang
// rather than fail — Clerk's getToken() in particular never settles if the
// client hasn't finished loading. That is not hypothetical: it produced an
// infinite spinner on the player, because an awaited hung promise is not
// abortable.
//
// So every pre-flight lookup gets its own short deadline, the two lookups run
// side by side (a stalled keychain and a stalled Clerk cost 3s, not 6s), and
// the request's own 12s deadline starts only once the headers exist — it
// bounds the network, not the lookups.
const PREFLIGHT_TIMEOUT_MS = 3_000;

async function settleOr<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<F>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function settleOrNull<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return settleOr(p, ms, null);
}

// Which credential a request carries.
//
//   "optional" — the session token when there is one, anonymous otherwise: a
//                Clerk hiccup degrades to signed-out rather than to a blank
//                screen. The default.
//   false      — Clerk is never asked. For the reads whose answer is the same
//                for everyone (config, catalog, a show): they never wait on
//                Clerk, and without an Authorization header the CDN may serve
//                them from its 60s copy (Vercel caches no request that
//                carries one) instead of waking the database.
//   "required" — a write that means something only for the right person
//                (progress, retention buckets). Clerk ANSWERING "nobody is
//                signed in" still goes out anonymously — a signed-out
//                viewer's device-keyed flush is theirs to send. Clerk NOT
//                answering (the 3s deadline, a rejection) is not "signed
//                out": sending anonymously would be refused (401 / 403) and
//                the write dropped as final, so it fails as a network error
//                instead, which callers retry.
type AuthMode = false | "optional" | "required";

const NO_ANSWER = Symbol("no answer");

function lookupToken(auth: AuthMode): Promise<string | null | typeof NO_ANSWER> {
  const provider = authTokenProvider;
  if (auth === false || !provider) return Promise.resolve(null);
  // Through .then(), so a provider that throws instead of rejecting is the
  // same "no answer".
  return settleOr(Promise.resolve().then(provider), PREFLIGHT_TIMEOUT_MS, NO_ANSWER);
}

async function buildHeaders(hasBody: boolean, auth: AuthMode): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hasBody) headers["Content-Type"] = "application/json";

  const [deviceId, token] = await Promise.all([
    settleOrNull(getDeviceId(), PREFLIGHT_TIMEOUT_MS),
    lookupToken(auth),
  ]);
  if (deviceId) headers["X-Matio-Device-Id"] = deviceId;

  if (token === NO_ANSWER) {
    if (auth === "required") {
      throw new ApiError("network", "Couldn't confirm who is signed in.", 0);
    }
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function request<T>(
  path: string,
  init: {
    method: "GET" | "POST";
    body?: unknown;
    auth?: AuthMode;
    timeoutMs?: number;
  } = { method: "GET" },
): Promise<T> {
  const headers = await buildHeaders(init.body !== undefined, init.auth ?? "optional");

  // AbortSignal.timeout() is not reliably present in Hermes, so drive the
  // controller manually.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new ApiError(
      "network",
      aborted ? "The request timed out." : "Couldn't reach Matio.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const raw: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    if (isErrorBody(raw)) {
      throw new ApiError(raw.error.code, raw.error.message, res.status, raw.error.reason);
    }
    throw new ApiError("server_error", `Request failed (${res.status}).`, res.status);
  }

  if (raw === null) {
    throw new ApiError("malformed", "Unreadable response from Matio.", res.status);
  }

  return raw as T;
}

export const api = {
  config: () => request<AppConfig>("/api/v1/config", { method: "GET", auth: false }),
  catalog: () => request<CatalogResponse>("/api/v1/catalog", { method: "GET", auth: false }),
  show: (slug: string) =>
    request<ShowDetail>(`/api/v1/shows/${encodeURIComponent(slug)}`, {
      method: "GET",
      auth: false,
    }),
  playbackToken: (episodeId: string) =>
    request<PlaybackTokenResponse>("/api/v1/playback-token", {
      method: "POST",
      body: { episodeId },
    }),
  // Signed-in only (401 otherwise) — the caller gates on auth so a refused
  // request is never even sent. See watch/use-progress-saver.ts. "required":
  // a token that does not arrive in time fails the save as a network error
  // rather than sending it anonymously into that 401.
  saveProgress: (body: SaveProgressRequest) =>
    request<SaveProgressResponse>("/api/v1/progress", { method: "POST", body, auth: "required" }),
  // The signed-in viewer's own resume point for one episode (0 without a
  // row) — what the player opens at (#303). "required" for the same reason
  // as the save: the answer exists only for the Bearer's owner, so a token
  // that does not arrive fails fast instead of going out into a certain 401.
  episodeProgress: (episodeId: string) =>
    request<EpisodeProgressResponse>(
      `/api/v1/progress?episodeId=${encodeURIComponent(episodeId)}`,
      { method: "GET", auth: "required" },
    ),
  continueWatching: () => request<ContinueResponse>("/api/v1/continue"),
  // Retention buckets. Signed-in or device-keyed; the server bounds them to
  // the episode and the positional gate. Goes through the offline queue in
  // watch/segment-queue.ts, never called directly by a screen.
  saveWatchSegments: (body: SaveWatchSegmentsRequest) =>
    request<SaveWatchSegmentsResponse>("/api/v1/watch-segments", {
      method: "POST",
      body,
      auth: "required",
    }),
  // «Delete account» (#309). Bearer-only on the server; "required" so a token
  // that does not arrive fails as a network error before any request, never
  // an anonymous call into the 401. Safe to repeat after any failure — the
  // server's two halves are idempotent.
  deleteAccount: () =>
    request<DeleteAccountResponse>("/api/v1/account/delete", {
      method: "POST",
      auth: "required",
      timeoutMs: ACCOUNT_DELETE_TIMEOUT_MS,
    }),
};

// Mux HLS URL for a signed playback ID. Kept here so the URL shape lives next
// to the call that produces its token — the token is useless without it, and
// splitting them invites one being changed without the other.
export function muxStreamUrl(playbackId: string, token: string): string {
  return `https://stream.mux.com/${playbackId}.m3u8?token=${encodeURIComponent(token)}`;
}
