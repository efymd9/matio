import type {
  ApiErrorBody,
  ApiErrorCode,
  AppConfig,
  CatalogResponse,
  PlaybackTokenResponse,
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
// infinite spinner on the player, because the request deadline below only
// starts at fetch() and an awaited hung promise is not abortable.
//
// So every pre-flight lookup gets its own short deadline and degrades to
// "anonymous, untracked" — which the server handles — instead of stalling.
const PREFLIGHT_TIMEOUT_MS = 3_000;

async function settleOrNull<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function buildHeaders(hasBody: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hasBody) headers["Content-Type"] = "application/json";

  const deviceId = await settleOrNull(getDeviceId(), PREFLIGHT_TIMEOUT_MS);
  if (deviceId) headers["X-Matio-Device-Id"] = deviceId;

  // Never let a token failure break an otherwise-anonymous-capable request:
  // the whole catalog is readable signed-out, and a Clerk hiccup should
  // degrade to signed-out rather than to a blank screen.
  if (authTokenProvider) {
    const token = await settleOrNull(authTokenProvider(), PREFLIGHT_TIMEOUT_MS);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<T> {
  // AbortSignal.timeout() is not reliably present in Hermes, so drive the
  // controller manually.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method,
      headers: await buildHeaders(init.body !== undefined),
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
  config: () => request<AppConfig>("/api/v1/config"),
  catalog: () => request<CatalogResponse>("/api/v1/catalog"),
  show: (slug: string) =>
    request<ShowDetail>(`/api/v1/shows/${encodeURIComponent(slug)}`),
  playbackToken: (episodeId: string) =>
    request<PlaybackTokenResponse>("/api/v1/playback-token", {
      method: "POST",
      body: { episodeId },
    }),
};

// Mux HLS URL for a signed playback ID. Kept here so the URL shape lives next
// to the call that produces its token — the token is useless without it, and
// splitting them invites one being changed without the other.
export function muxStreamUrl(playbackId: string, token: string): string {
  return `https://stream.mux.com/${playbackId}.m3u8?token=${encodeURIComponent(token)}`;
}
