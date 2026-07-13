import "server-only";
import jwt from "jsonwebtoken";

// Mux JWT audience claims:
//   'v' — video playback (manifest + segments)
//   't' — image thumbnails / poster
//   's' — storyboards
// Same RS256 signing key works for all of them; only `aud` and TTL vary.
type Audience = "v" | "t" | "s";

function signMuxToken(
  playbackId: string,
  ttlSeconds: number,
  aud: Audience,
): string {
  const keyId = process.env.MUX_SIGNING_KEY_ID;
  const privateKeyBase64 = process.env.MUX_SIGNING_KEY_PRIVATE_KEY;
  if (!keyId || !privateKeyBase64) {
    throw new Error(
      "MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE_KEY must be set",
    );
  }

  const privateKey = Buffer.from(privateKeyBase64, "base64").toString("utf-8");

  return jwt.sign(
    {
      sub: playbackId,
      aud,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: keyId,
    },
  );
}

// Signs a Mux playback JWT (RS256). Mux signing keys are created in
// dashboard.mux.com → Settings → Signing Keys. Store the key id directly
// and the private key as a base64-encoded PEM (avoids env-var newline pain).
export function signMuxPlaybackToken(
  playbackId: string,
  ttlSeconds: number,
): string {
  return signMuxToken(playbackId, ttlSeconds, "v");
}

// Signs a Mux thumbnail JWT — same key + algorithm, audience 't'. Used to
// build authenticated image.mux.com URLs for episodes whose playback policy
// is "signed". Public-policy assets don't need a token at all.
export function signMuxThumbnailToken(
  playbackId: string,
  ttlSeconds: number,
): string {
  return signMuxToken(playbackId, ttlSeconds, "t");
}

// Build a Mux thumbnail URL for an episode. Returns null when the asset
// hasn't been provisioned yet. For signed-policy assets we mint a JWT with
// the given TTL; for public assets the URL has no token. Width/height/time
// are baked into the URL so the cache key is stable per call.
const THUMBNAIL_TTL_SECONDS = 60 * 60; // 1h — covers most session lengths

export function muxThumbnailUrl(
  playbackId: string,
  playbackPolicy: "public" | "signed" | string | null,
  opts: {
    time?: number;
    width?: number;
    height?: number;
    // Override for consumers whose image is fetched long after minting —
    // the reminder email's hero still (Gmail's image proxy can fetch days
    // after send). Page renders keep the 1h default.
    ttlSeconds?: number;
  } = {},
): string {
  const params = new URLSearchParams();
  if (opts.width) params.set("width", String(opts.width));
  if (opts.height) params.set("height", String(opts.height));
  if (opts.time !== undefined) params.set("time", String(opts.time));
  // Squeeze frame focus to "smart" so Mux picks an interesting frame when
  // no explicit time is given. Mux defaults to time=0 otherwise — usually
  // a black frame from the fade-in.
  if (opts.time === undefined) params.set("fit_mode", "smartcrop");
  if (playbackPolicy === "signed") {
    params.set(
      "token",
      signMuxThumbnailToken(playbackId, opts.ttlSeconds ?? THUMBNAIL_TTL_SECONDS),
    );
  }
  const qs = params.toString();
  return `https://image.mux.com/${playbackId}/thumbnail.jpg${qs ? `?${qs}` : ""}`;
}
