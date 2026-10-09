import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { settleOrNull } from "@/api/client";

// «Delete account» for an account that signed in with Apple (#407, App Store
// 5.1.1(v)): Apple asks that the app's grant on the person's Apple ID be
// revoked, and the server can revoke only with a token it gets by exchanging
// an authorization code (lib/apple-revoke.ts). Nobody kept one from the
// sign-in — @clerk/expo's hook hands Clerk Apple's identity token and drops
// the code — so the Account tab asks Apple for a FRESH code right before the
// deletion request and sends it along. Apple's sheet appears once more: that
// is Apple's own documented way to get a code for an existing user.
//
// Best-effort, never throws: a cancelled sheet (ERR_REQUEST_CANCELED), an
// unavailable or failing Apple, Android, or an account with no Apple sign-in
// all answer `undefined`, and the deletion goes ahead without a code — the
// person asked for their account to go, and the revocation never decides
// that. No scopes are requested: only the code is wanted, and the credential
// (name, address, tokens) is neither read nor kept beyond it.
//
// The sheet waits on a person (Face ID, a password), so its deadline is
// generous — but there is one: a native promise that never settles would
// otherwise hold «Delete account» on its spinner forever, with no request
// sent. Past it the answer is «no code», as for a cancelled sheet, and the
// deletion goes ahead (a code Apple hands over later is simply dropped).
export const APPLE_SHEET_TIMEOUT_MS = 120_000;

// The fields read off Clerk's user, structurally — `provider` is "apple"
// (clerk-js strips the `oauth_` prefix of the Backend API's value).
type UserWithExternalAccounts = {
  externalAccounts?: ReadonlyArray<{ provider?: string | null }> | null;
} | null | undefined;

export function signedInWithApple(user: UserWithExternalAccounts): boolean {
  return user?.externalAccounts?.some((account) => account.provider === "apple") ?? false;
}

export async function appleCodeForDeletion(
  user: UserWithExternalAccounts,
): Promise<string | undefined> {
  if (Platform.OS !== "ios" || !signedInWithApple(user)) return undefined;
  // settleOrNull answers null for a rejection (a cancelled sheet, a failing
  // Apple) and for the deadline alike.
  const credential = await settleOrNull(
    (async () => {
      if (!(await AppleAuthentication.isAvailableAsync())) return null;
      return AppleAuthentication.signInAsync({ requestedScopes: [] });
    })(),
    APPLE_SHEET_TIMEOUT_MS,
  );
  return credential?.authorizationCode ?? undefined;
}
