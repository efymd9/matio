import "server-only";
import jwt from "jsonwebtoken";
import { describeError } from "@/lib/observability";

// Sign in with Apple: revoke the person's grant when their account is deleted
// (#407, App Store 5.1.1(v) — «Apps that support Sign in with Apple should use
// the Sign in with Apple REST API to revoke user tokens»).
//
// Why the app has to hand us a code: `/auth/revoke` takes only a refresh token
// or an access token, and nobody holds one. The app's native sign-in
// (@clerk/expo's useSignInWithApple) gives Clerk Apple's identity token alone
// (`oauth_token_apple`) and drops the authorization code, and tokens exist
// only where a code was exchanged at `/auth/token`. So «Delete account» asks
// Apple for a FRESH authorization code on the device (mobile/src/auth/
// apple-revocation.ts) and sends it with the request; here it is exchanged
// (single use, valid five minutes) and the refresh token it yields revoked
// at once. Evidence and the rejected alternatives: #407.
//
//   POST https://appleid.apple.com/auth/token   client_id, client_secret,
//                                                code, grant_type=authorization_code
//   POST https://appleid.apple.com/auth/revoke  client_id, client_secret,
//                                                token, token_type_hint
//
// No `redirect_uri`: a code minted by the native sheet was requested without
// one, and Apple wants it only when the authorization request carried it.
//
// Best-effort with the PostHog / Stripe contract of the erasure: one bounded
// attempt per request (5s), no retries, never throws — the deletion the person
// asked for never waits on Apple, and the typed result is what the route
// logs. Nothing that comes back is kept or logged: Apple's token response
// carries an id_token with the Apple ID's address, and the tokens themselves
// are credentials. Of an error body only Apple's `error` code is read, and only
// when it is one of the six values Apple documents (ErrorResponse).
//
// Configuration (Vercel env; all three, or the step is skipped):
//   APPLE_TEAM_ID              — the team that owns tv.matio.app (`iss`)
//   APPLE_SIGN_IN_KEY_ID       — the Sign in with Apple key's id (`kid`)
//   APPLE_SIGN_IN_PRIVATE_KEY  — that key's .p8, as downloaded (real or
//                                `\n`-escaped newlines) or base64 of it, the
//                                MUX_SIGNING_KEY_PRIVATE_KEY convention

// The app's App ID — the bundle id the native sheet authorizes for. Not an env
// var: it is the same in every environment (one app), and it survives an App
// Transfer; the Team ID does not, which is why that one is configured.
export const APPLE_CLIENT_ID = "tv.matio.app";

const APPLE_ID_ORIGIN = "https://appleid.apple.com";

export const APPLE_REQUEST_TIMEOUT_MS = 5_000;

// Apple allows up to six months; this secret is minted per deletion and dies
// with it.
const CLIENT_SECRET_TTL_SECONDS = 300;

// An authorization code is a short opaque string (well under a hundred
// characters). Anything far longer is not one and is not forwarded to Apple.
const MAX_CODE_LENGTH = 1_024;

const APPLE_ERROR_CODES = [
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
] as const;
type AppleErrorCode = (typeof APPLE_ERROR_CODES)[number];

export type AppleRevocation =
  // Apple accepted the revocation: the grant is gone from the person's Apple ID.
  | { status: "revoked" }
  // The request carried no code: an account without Apple, an app build from
  // before #407, a sheet the person cancelled, or Android.
  | { status: "skipped_no_code" }
  // A code arrived but the env above is incomplete — nothing was sent to Apple.
  | { status: "skipped_unconfigured" }
  | {
      status: "failed";
      // client_secret — the key would not sign (a malformed .p8);
      // token — the exchange; revoke — the revocation itself.
      step: "client_secret" | "token" | "revoke";
      httpStatus?: number;
      // Apple's own code (`invalid_grant` — the code expired or was used;
      // `invalid_client` — the key, Key ID or Team ID is wrong), `other` for
      // anything outside its list, `no_token` for a 200 without a token.
      appleError?: AppleErrorCode | "other" | "no_token";
      // A thrown fetch (timeout, DNS, reset) or signer: class and code only.
      error?: ReturnType<typeof describeError>;
    };

/** The code from the delete request's JSON body, if it carries a usable one. */
export function appleAuthorizationCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const code = (body as { appleAuthorizationCode?: unknown }).appleAuthorizationCode;
  if (typeof code !== "string") return undefined;
  const trimmed = code.trim();
  return trimmed !== "" && trimmed.length <= MAX_CODE_LENGTH ? trimmed : undefined;
}

type AppleConfig = { teamId: string; keyId: string; privateKey: string };

function readConfig(): AppleConfig | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_SIGN_IN_KEY_ID?.trim();
  const raw = process.env.APPLE_SIGN_IN_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !raw) return null;
  const privateKey = raw.includes("-----BEGIN")
    ? raw.replace(/\\n/g, "\n")
    : Buffer.from(raw, "base64").toString("utf8");
  return { teamId, keyId, privateKey };
}

// Apple's client secret: an ES256 JWT signed with the Sign in with Apple key.
function clientSecret(cfg: AppleConfig): string {
  return jwt.sign(
    { iss: cfg.teamId, sub: APPLE_CLIENT_ID, aud: APPLE_ID_ORIGIN },
    cfg.privateKey,
    { algorithm: "ES256", keyid: cfg.keyId, expiresIn: CLIENT_SECRET_TTL_SECONDS },
  );
}

function post(path: string, form: Record<string, string>): Promise<Response> {
  return fetch(`${APPLE_ID_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form),
    cache: "no-store",
    signal: AbortSignal.timeout(APPLE_REQUEST_TIMEOUT_MS),
  });
}

async function appleError(res: Response): Promise<AppleErrorCode | "other"> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const code = body?.error;
  return APPLE_ERROR_CODES.find((known) => known === code) ?? "other";
}

/**
 * Exchange the code and revoke what it yields. Never throws; the result is
 * typed and carries no token, no code and nothing from the person's Apple ID.
 */
export async function revokeAppleAuthorization(
  code: string | undefined,
): Promise<AppleRevocation> {
  if (!code) return { status: "skipped_no_code" };
  const cfg = readConfig();
  if (!cfg) return { status: "skipped_unconfigured" };

  let secret: string;
  try {
    secret = clientSecret(cfg);
  } catch (err) {
    return { status: "failed", step: "client_secret", error: describeError(err) };
  }
  const client = { client_id: APPLE_CLIENT_ID, client_secret: secret };

  let token: { value: string; hint: "refresh_token" | "access_token" };
  try {
    const res = await post("/auth/token", {
      ...client,
      code,
      grant_type: "authorization_code",
    });
    if (!res.ok) {
      return {
        status: "failed",
        step: "token",
        httpStatus: res.status,
        appleError: await appleError(res),
      };
    }
    const body = (await res.json().catch(() => null)) as {
      refresh_token?: unknown;
      access_token?: unknown;
    } | null;
    // The refresh token is the grant; revoking it ends the authorization.
    // An access token is Apple's other accepted handle, kept as the fallback.
    if (typeof body?.refresh_token === "string" && body.refresh_token !== "") {
      token = { value: body.refresh_token, hint: "refresh_token" };
    } else if (typeof body?.access_token === "string" && body.access_token !== "") {
      token = { value: body.access_token, hint: "access_token" };
    } else {
      return { status: "failed", step: "token", httpStatus: res.status, appleError: "no_token" };
    }
  } catch (err) {
    return { status: "failed", step: "token", error: describeError(err) };
  }

  try {
    const res = await post("/auth/revoke", {
      ...client,
      token: token.value,
      token_type_hint: token.hint,
    });
    if (!res.ok) {
      return {
        status: "failed",
        step: "revoke",
        httpStatus: res.status,
        appleError: await appleError(res),
      };
    }
    return { status: "revoked" };
  } catch (err) {
    return { status: "failed", step: "revoke", error: describeError(err) };
  }
}
