import type { ConfigContext, ExpoConfig } from "expo/config";

// The dynamic half of the app config (#277). Everything static stays in
// app.json; this file only adds what has to come from the BUILD's
// environment — the native Google sign-in's ids, which live in EAS env and
// never in the repo:
//
//   EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID — the Web OAuth client Clerk's
//     Google connection already uses (the token's audience);
//   EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID — the iOS OAuth client of the
//     same Google Cloud project, bundle id tv.matio.app;
//   EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME — optional: the iOS client id
//     reversed, which Google Sign-In needs registered as a URL scheme.
//     Derived from the iOS id when unset, so the owner sets two values, not
//     three that could disagree.
//
// They go into `extra` because that is where @clerk/expo's Google hook
// reads them in a release build (Expo inlines EXPO_PUBLIC_* only in app
// code, not inside node_modules), and where @clerk/expo-google-signin's
// config plugin reads the URL scheme. A build without them is a build
// without the Google button (mobile/src/auth/social.ts), not a broken one.
// None of them is a secret — an OAuth client id ships inside every app.

const WEB_CLIENT_ID = "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID";
const IOS_CLIENT_ID = "EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID";
const IOS_URL_SCHEME = "EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME";

const GOOGLE_CLIENT_SUFFIX = ".apps.googleusercontent.com";

// `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`
// — the "reversed client id" Google's console shows next to an iOS client.
// Anything not shaped like a Google client id gets no scheme: a wrong one
// would only fail later, inside Google's SDK, on the first tap.
export function googleIosUrlScheme(iosClientId: string): string | undefined {
  const id = iosClientId.trim();
  if (!id.endsWith(GOOGLE_CLIENT_SUFFIX) || id.length === GOOGLE_CLIENT_SUFFIX.length) {
    return undefined;
  }
  return `com.googleusercontent.apps.${id.slice(0, -GOOGLE_CLIENT_SUFFIX.length)}`;
}

// The `extra` entries for the environment given — only the ones that are
// set, so an unconfigured build carries no empty strings.
export function googleSignInExtra(env: Record<string, string | undefined>): Record<string, string> {
  const extra: Record<string, string> = {};
  const web = env[WEB_CLIENT_ID]?.trim();
  const ios = env[IOS_CLIENT_ID]?.trim();
  if (web) extra[WEB_CLIENT_ID] = web;
  if (ios) {
    extra[IOS_CLIENT_ID] = ios;
    const scheme = env[IOS_URL_SCHEME]?.trim() || googleIosUrlScheme(ios);
    if (scheme) extra[IOS_URL_SCHEME] = scheme;
  }
  return extra;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const { name, slug } = config;
  if (!name || !slug) throw new Error("app.json must define expo.name and expo.slug");
  return {
    ...config,
    name,
    slug,
    extra: { ...config.extra, ...googleSignInExtra(process.env) },
  };
};
