import type { SocialSignIn } from "@/shared/api-types";

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

// The two names @clerk/expo's native Google hook looks up — in the app
// config's `extra` first (app.config.ts copies them there from the build's
// environment), then in process.env, which Expo does NOT inline inside
// node_modules, so in a release build `extra` is the only place it finds
// them. Without both the hook throws on the first tap, so without both
// there is no button.
export const GOOGLE_WEB_CLIENT_ID = "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID";
export const GOOGLE_IOS_CLIENT_ID = "EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID";

export function googleSignInConfigured(extra: Record<string, unknown> | null | undefined): boolean {
  const filled = (name: string) => {
    const value = extra?.[name];
    return typeof value === "string" && value.trim() !== "";
  };
  return filled(GOOGLE_WEB_CLIENT_ID) && filled(GOOGLE_IOS_CLIENT_ID);
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
  if (signUpMoved && signUp?.status === "missing_requirements") return "incomplete";
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
