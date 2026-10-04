import type { ConfigContext, ExpoConfig } from "expo/config";
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_IOS_URL_SCHEME,
  GOOGLE_WEB_CLIENT_ID,
  googleIosUrlScheme,
} from "./google-signin-config";

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
// config plugin reads the URL scheme. A build whose scheme is missing or is
// not the reversed iOS id has NO Google button (src/auth/social.ts checks
// exactly that, with the same helper): Google's SDK raises an uncatchable
// native exception on the first tap when the scheme is not registered.
// None of them is a secret — an OAuth client id ships inside every app.

// The `extra` entries for the environment given — only the ones that are
// set, so an unconfigured build carries no empty strings.
export function googleSignInExtra(env: Record<string, string | undefined>): Record<string, string> {
  const extra: Record<string, string> = {};
  const web = env[GOOGLE_WEB_CLIENT_ID]?.trim();
  const ios = env[GOOGLE_IOS_CLIENT_ID]?.trim();
  if (web) extra[GOOGLE_WEB_CLIENT_ID] = web;
  if (ios) {
    extra[GOOGLE_IOS_CLIENT_ID] = ios;
    // An explicit scheme is the plugin's own first choice too (it reads the
    // variable before `extra`), so `extra` carries the same value; when it
    // is not the reversed id, the button stays hidden.
    const scheme = env[GOOGLE_IOS_URL_SCHEME]?.trim() || googleIosUrlScheme(ios);
    if (scheme) extra[GOOGLE_IOS_URL_SCHEME] = scheme;
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
