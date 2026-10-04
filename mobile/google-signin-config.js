// @ts-check
// The native Google sign-in's build configuration (#277), shared by the two
// sides that must agree on it: app.config.ts (Node, while Expo evaluates the
// config and @clerk/expo-google-signin's plugin registers the URL scheme) and
// src/auth/social.ts (the app, deciding whether the Google button may show).
//
// Plain CommonJS on purpose: Expo loads app.config.ts through its own
// transpiler, and whatever that file imports goes through Node's plain
// require — which finds a .js file on every Node, but a .ts one only with an
// explicit extension and a Node new enough to strip types.

// The names the build's environment and the config's `extra` use — the same
// names @clerk/expo's Google hook and the plugin look up.
const GOOGLE_WEB_CLIENT_ID = "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID";
const GOOGLE_IOS_CLIENT_ID = "EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID";
const GOOGLE_IOS_URL_SCHEME = "EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME";

const GOOGLE_CLIENT_SUFFIX = ".apps.googleusercontent.com";

/**
 * `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`
 * — the "reversed client id" Google's console shows next to an iOS client,
 * which Google Sign-In needs registered as a URL scheme. Anything not shaped
 * like a Google client id has none.
 *
 * @param {unknown} iosClientId
 * @returns {string | undefined}
 */
function googleIosUrlScheme(iosClientId) {
  if (typeof iosClientId !== "string") return undefined;
  const id = iosClientId.trim();
  if (!id.endsWith(GOOGLE_CLIENT_SUFFIX) || id.length === GOOGLE_CLIENT_SUFFIX.length) {
    return undefined;
  }
  return `com.googleusercontent.apps.${id.slice(0, -GOOGLE_CLIENT_SUFFIX.length)}`;
}

module.exports = {
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_IOS_URL_SCHEME,
  googleIosUrlScheme,
};
