// Google's own sign-in SDK (#277 — under «Continue with Google», through
// @clerk/expo-google-signin's native module) keeps the signed-in Google user
// — its tokens and profile — in the device keychain, so that a later sign-in
// can be restored. Clerk's signOut ends the MATIO session only; nothing in
// Clerk clears Google's. So the app ends it itself, right before Clerk's
// signOut, on «Sign out» and on «Delete account» (the Account tab).
//
// The module is the one @clerk/expo's Google hook drives; @clerk/expo has no
// public JavaScript for it, and its own code loads it exactly this way, by
// name. Loaded on demand, so a screen that only imports this file pulls in
// nothing native. Best-effort and bounded: a build without the module, a
// failure or a slow answer never stands between the viewer and signing out.
// On iOS it is GIDSignIn.signOut() — local, nothing goes to Google; on a
// device that never used Google it does nothing.

export const GOOGLE_SIGN_OUT_TIMEOUT_MS = 2_000;

type GoogleSignInModule = { signOut(): Promise<void> };

export async function endGoogleSession(): Promise<void> {
  const attempt = (async () => {
    const { requireOptionalNativeModule } = await import("expo");
    await requireOptionalNativeModule<GoogleSignInModule>("ClerkGoogleSignIn")?.signOut();
  })().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, GOOGLE_SIGN_OUT_TIMEOUT_MS);
  });
  try {
    await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
