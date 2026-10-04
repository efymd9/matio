import type { SocialSignIn } from "@/shared/api-types";
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_IOS_URL_SCHEME,
  GOOGLE_WEB_CLIENT_ID,
  googleIosUrlScheme,
} from "../../google-signin-config";

// The rules of the Apple / Google buttons under the email form (#277) — pure,
// no React and no native module, so every branch is a unit test
// (social.test.ts). components/social-sign-in.tsx reads the device and Clerk
// and hands the facts in; what to show and what an answer means is decided
// here.

export type SocialProvider = "apple" | "google";

// Which buttons go under the email form, top to bottom. Every condition only
// takes a button away:
//   - the server's lever (/v1/config `socialSignIn`, APP_SOCIAL_SIGNIN) —
//     missing (a server from before #277) reads as both off;
//   - iOS only: Android's Google sign-in (Credential Manager) and an Apple
//     flow there are not built (registry);
//   - Apple: the device says Sign in with Apple is available;
//   - Google: the build carries both client ids (googleSignInConfigured);
//   - App Store 4.8: an app that offers Google must offer Sign in with Apple
//     next to it, and our email code cannot hide the address, so it does not
//     count. On iOS Google therefore never stands alone — no Apple, no
//     Google — and it always comes second (Apple above it and the same size,
//     the HIG).
export function socialProviders({
  os,
  lever,
  appleAvailable,
  googleConfigured,
}: {
  os: string;
  lever: SocialSignIn | undefined;
  appleAvailable: boolean;
  googleConfigured: boolean;
}): SocialProvider[] {
  if (os !== "ios" || !lever) return [];
  if (!lever.apple || !appleAvailable) return [];
  return lever.google && googleConfigured ? ["apple", "google"] : ["apple"];
}

// Whether this build can run the native Google sign-in at all, read from the
// app config's `extra` — where app.config.ts puts what the build's
// environment carried, and where @clerk/expo's Google hook looks first
// (process.env is NOT inlined inside node_modules, so in a release build
// `extra` is the only place it finds the ids). Three things, all checked:
//   - the web and the iOS client id — without either the hook throws on the
//     first tap;
//   - the URL scheme the plugin registered, and it must be exactly the
//     reversed iOS id (the same helper app.config.ts derives it with):
//     without it Google's SDK raises a native exception on the first tap
//     that no JavaScript catch can stop — the app would crash.
// Anything short of all three is a build without the Google button.
export function googleSignInConfigured(extra: Record<string, unknown> | null | undefined): boolean {
  const web = extra?.[GOOGLE_WEB_CLIENT_ID];
  const ios = extra?.[GOOGLE_IOS_CLIENT_ID];
  const scheme = googleIosUrlScheme(ios);
  return (
    typeof web === "string" &&
    web.trim() !== "" &&
    scheme !== undefined &&
    extra?.[GOOGLE_IOS_URL_SCHEME] === scheme
  );
}

// What a finished flow meant. Clerk's legacy hooks (useSignInWithApple,
// useSignInWithGoogle) RESOLVE in three different situations with the same
// `createdSessionId: null`: the viewer closed the system sheet (the hooks
// swallow ERR_REQUEST_CANCELED / SIGN_IN_CANCELLED themselves), Clerk made
// an account but it still misses something (an Apple ID that shared no
// email, while the instance requires one), or a sign-in stopped short of a
// session. The only honest way to tell them apart is whether the flow
// touched Clerk at all: a cancelled sheet returns before any Clerk call, so
// the sign-in and sign-up the hook hands back are the ones that were there
// before the tap (their ids unchanged). An id read before the tap is the
// witness — a status alone is not: the email form's own sign-up sits in
// `missing_requirements` until its code is verified.
//
// «Incomplete» (the provider made an account without an address) is ONLY a
// new sign-up that stopped short while the sign-in did not move. When both
// moved, the flow was a transfer — an Apple ID or Google account that
// already has a Matio account: the sign-up is left `missing_requirements`
// by design and the transfer sign-in is what stopped short (a second factor,
// say) — the address WAS shared, so that is a failure, not «we didn't get
// your email».
export type SocialOutcome = "signedIn" | "cancelled" | "incomplete" | "failed";

type Attempt = { id?: string | null; status?: string | null } | null | undefined;

export function classifySocialResult({
  createdSessionId,
  before,
  signIn,
  signUp,
}: {
  createdSessionId: string | null;
  before: { signInId: string | null | undefined; signUpId: string | null | undefined };
  signIn?: Attempt;
  signUp?: Attempt;
}): SocialOutcome {
  if (createdSessionId) return "signedIn";
  const signUpMoved = Boolean(signUp?.id) && signUp?.id !== before.signUpId;
  const signInMoved = Boolean(signIn?.id) && signIn?.id !== before.signInId;
  if (signUpMoved && !signInMoved && signUp?.status === "missing_requirements") return "incomplete";
  if (signUpMoved || signInMoved) return "failed";
  return "cancelled";
}

// A thrown failure, sorted the way the viewer is told about it. The machine
// code sits on `errors[0]` of a Clerk API error, on the error itself for a
// Clerk runtime error ("network_error") and for the native modules' own
// (Apple's ERR_REQUEST_*, Google's GOOGLE_SIGN_IN_ERROR). Only the code is
// ever read — never a message, which can carry the provider's account data.
export type SocialFailure = "network" | "rate_limited" | "other";

export function socialFailureCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { errors?: { code?: unknown }[]; code?: unknown };
  const code = e.errors?.[0]?.code ?? e.code;
  return typeof code === "string" ? code : undefined;
}

export function socialFailure(err: unknown): SocialFailure {
  switch (socialFailureCode(err)) {
    case "network_error":
      return "network";
    case "too_many_requests":
      return "rate_limited";
    default:
      return "other";
  }
}
