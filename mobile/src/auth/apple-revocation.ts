import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";

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
  try {
    if (!(await AppleAuthentication.isAvailableAsync())) return undefined;
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    return credential.authorizationCode ?? undefined;
  } catch {
    return undefined;
  }
}
