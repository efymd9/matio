import "server-only";
import jwt from "jsonwebtoken";

// Signs a Mux playback JWT (RS256). Mux signing keys are created in
// dashboard.mux.com → Settings → Signing Keys. Store the key id directly
// and the private key as a base64-encoded PEM (avoids env-var newline pain).
export function signMuxPlaybackToken(
  playbackId: string,
  ttlSeconds: number,
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
      aud: "v", // 'v' = video playback
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: keyId,
    },
  );
}
