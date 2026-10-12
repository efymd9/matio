import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { settleOrNull } from "@/api/client";

// «Delete account» for an account that signed in with Apple (#407, App Store
// 5.1.1(v)): Apple asks that the app's grant on the person's Apple ID be
// revoked, and the server can revoke only with a token it gets by exchanging
// an authorization code (lib/apple-revoke.ts). Nobody kept one from the
// sign-in — @clerk/expo's hook hands Clerk Apple's identity token and drops
// the code — so the Account tab asks Apple for a FRESH code during the
// deletion and sends it along. Apple's sheet appears once more: that is
// Apple's own documented way to get a code for an existing user.
//
// Where the sheet sits in the deletion (the owner's option (а), PR #427):
// BETWEEN the first confirmation and the final «Delete permanently», so a
// Cancel at any step means «not yet» — nothing irreversible happens before
// the last button. The tab reads the three answers below:
//   code      → the final confirmation, then the request carrying the code;
//   cancelled → the person dismissed Apple's sheet: no request, the account
//               stays, they can try again;
//   failed    → Apple could not give a code — unavailable, an error, no code
//               in the credential, the deadline — or gave one for ANOTHER
//               Apple Account than the one this Matio account is linked to
//               (below). Not the person's choice, and a hard stop here would
//               make deletion impossible in the app for anyone whose sheet
//               cannot work (no Apple Account on this device, a restricted
//               one): so the final confirmation still comes, but says Matio
//               stays connected to the Apple Account.
// UNVERIFIED on a device: that «no Apple Account on this device» arrives as
// `failed`. If iOS reports the person closing its «sign in to your Apple
// Account» prompt as ERR_REQUEST_CANCELED, it reads as `cancelled` — «your
// account is still here» on every attempt, no way to delete in the app. A
// gate of the #407 device check, with the planned fallback, in
// docs/registry.md.
// No scopes are requested: only the code is wanted, and the credential
// (name, address, tokens) is neither read nor kept beyond it — `user` is
// compared with the linked id and dropped.
//
// The sheet waits on a person (Face ID, a password), so its deadline is
// generous — but there is one: a native promise that never settles would
// otherwise hold «Delete account» on its spinner forever. Past it the answer
// is `failed` (a code Apple hands over later is simply dropped).
export const APPLE_SHEET_TIMEOUT_MS = 120_000;

// The fields read off Clerk's user, structurally — `provider` is "apple"
// (clerk-js strips the `oauth_` prefix of the Backend API's value), and
// `providerUserId` is the Backend API's `provider_user_id` (clerk-js
// ExternalAccount.fromJSON; `ExternalAccountResource` in @clerk/shared).
type UserWithExternalAccounts = {
  externalAccounts?: ReadonlyArray<{ provider?: string | null; providerUserId?: string | null }> | null;
} | null | undefined;

export function signedInWithApple(user: UserWithExternalAccounts): boolean {
  return user?.externalAccounts?.some((account) => account.provider === "apple") ?? false;
}

// The Apple Account(s) this Matio account is linked to: for Apple, Clerk's
// `providerUserId` is Apple's stable user identifier — the identity token's
// `sub`, the same string Apple's sheet returns as `credential.user` for the
// same Apple Account and team. Empty when Clerk gave none; the sheet's code
// is then sent unchecked, as before (the device check confirms the match,
// docs/registry.md #407).
export function linkedAppleUserIds(user: UserWithExternalAccounts): string[] {
  return (user?.externalAccounts ?? [])
    .filter((account) => account.provider === "apple" && account.providerUserId)
    .map((account) => account.providerUserId as string);
}

// Whether «Delete account» passes through Apple's sheet: an Apple account on
// iOS. Everyone else — no Apple sign-in, or Android, which has no native
// Apple flow — keeps the two confirmations and nothing between them.
export function needsAppleSheet(user: UserWithExternalAccounts): boolean {
  return Platform.OS === "ios" && signedInWithApple(user);
}

export type AppleDeletionCode =
  | { status: "code"; code: string }
  | { status: "cancelled" }
  | { status: "failed" };

// Never throws. Only Apple's own ERR_REQUEST_CANCELED is a cancellation;
// every other rejection, an unavailable Apple and the deadline are `failed`.
//
// `linkedUserIds` (linkedAppleUserIds above): the sheet signs in with the
// Apple Account of THIS device, which need not be the one the Matio account
// was made with (signed up on another iPhone, a family device). Its code
// would let the server revoke that other account's grant and log `revoked`
// while the real one stays — so a code whose `credential.user` is not a
// linked id is dropped and the answer is `failed`: the final question then
// says, truthfully, that Matio stays connected to the Apple Account. (A
// first sign-in on that other account may itself leave a grant there; it
// stays too — docs/registry.md #407.)
export async function askAppleForDeletionCode(
  linkedUserIds: readonly string[] = [],
): Promise<AppleDeletionCode> {
  const answer = await settleOrNull(
    (async (): Promise<AppleDeletionCode> => {
      if (!(await AppleAuthentication.isAvailableAsync())) return { status: "failed" };
      try {
        const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
        if (!credential.authorizationCode) return { status: "failed" };
        if (linkedUserIds.length > 0 && !linkedUserIds.includes(credential.user)) return { status: "failed" };
        return { status: "code", code: credential.authorizationCode };
      } catch (err) {
        return (err as { code?: unknown } | null)?.code === "ERR_REQUEST_CANCELED"
          ? { status: "cancelled" }
          : { status: "failed" };
      }
    })(),
    APPLE_SHEET_TIMEOUT_MS,
  );
  // null: the availability check rejected, or the deadline passed.
  return answer ?? { status: "failed" };
}
