import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

// The app's audience-measurement identifier — the native equivalent of the
// web's matio_aid cookie, sent as X-Matio-Device-Id on every /v1 call.
//
// Minted once and never refreshed, matching the cookie's write-once semantics
// and the same consent-exempt legitimate-interests basis. It is a bare random
// UUID: all the data it keys lives server-side.
//
// Storage asymmetry to be aware of when reading app analytics: SecureStore is
// the iOS keychain, which SURVIVES app uninstall, while Android's backing store
// generally does not. App "unique visitors" therefore skew slightly high on
// Android. Documented rather than fixed — the alternative identifiers are worse
// for privacy.
const DEVICE_ID_KEY = "matio_device_id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cached: string | null = null;

export async function getDeviceId(): Promise<string | null> {
  if (cached) return cached;

  try {
    const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (stored && UUID_RE.test(stored)) {
      cached = stored;
      return cached;
    }

    const fresh = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    // Keychain unavailable (locked device, simulator quirk, user restrictions).
    // Measurement degrades to anonymous; playback must not care — the server
    // treats a missing device id as "untracked", never as "denied", except on
    // the legacy 60s-preview path which has nothing to meter without it.
    return null;
  }
}
