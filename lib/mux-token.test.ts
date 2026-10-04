import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { signMuxPlaybackToken, signMuxStoryboardToken } from "./mux-token";

// The real signer against a key pair made for the run (nothing secret is
// committed): what Mux will check is the audience, the subject and the
// expiry, so those are read back out of a verified token.

let publicKey: string;
let privateKeyBase64: string;

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  privateKeyBase64 = Buffer.from(pem).toString("base64");
});

beforeEach(() => {
  vi.stubEnv("MUX_SIGNING_KEY_ID", "dummy-key-id");
  vi.stubEnv("MUX_SIGNING_KEY_PRIVATE_KEY", privateKeyBase64);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function read(token: string) {
  const claims = jwt.verify(token, publicKey, { algorithms: ["RS256"] }) as jwt.JwtPayload;
  const header = jwt.decode(token, { complete: true })?.header;
  return { claims, kid: header?.kid };
}

describe("signMuxStoryboardToken (#375)", () => {
  it("signs for storyboards — audience `s` — with the playback token's expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));

    const storyboard = read(signMuxStoryboardToken("pb-1", 3600));
    const playback = read(signMuxPlaybackToken("pb-1", 3600));

    expect(storyboard.claims.aud).toBe("s");
    expect(storyboard.claims.sub).toBe("pb-1");
    expect(storyboard.kid).toBe("dummy-key-id");
    expect(playback.claims.aud).toBe("v");
    expect(storyboard.claims.exp).toBe(playback.claims.exp);
    expect(storyboard.claims.exp).toBe(Date.parse("2026-10-04T13:00:00Z") / 1000);
  });

  it("refuses to sign without the key, like the playback signer", () => {
    vi.stubEnv("MUX_SIGNING_KEY_PRIVATE_KEY", "");
    expect(() => signMuxStoryboardToken("pb-1", 60)).toThrow(/MUX_SIGNING_KEY/);
  });
});
