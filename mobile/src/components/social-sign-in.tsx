import { useClerk } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
import { useSignInWithGoogle } from "@clerk/expo/google";
import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useConfig } from "@/api/config-context";
import googleG from "@/assets/icons/google-g.svg";
import {
  classifySocialResult,
  googleSignInConfigured,
  socialFailure,
  socialFailureCode,
  socialProviders,
  type SocialProvider,
} from "@/auth/social";
import { useT } from "@/i18n/locale";
import { body, colors, space } from "@/theme";

// «Sign in with Apple» and «Continue with Google» under the email form
// (#277, the owner's board variant B: email first, the two providers below
// an «or continue with» line). Mounted by the form INSIDE its Clerk gate
// (#247) — every hook here needs <ClerkProvider> — and only on its email
// step. What to show and what an answer means are the pure rules of
// auth/social.ts; this file reads the device, the server's lever and Clerk.
//
// Both buttons are 48 pt high with a 12 pt radius (board). Apple's is the
// system ASAuthorizationAppleIDButton, white, «Continue with Apple» in the
// DEVICE's language (iOS draws the words; registry). Google's is drawn here
// to its brand guide: the dark theme, the unchanged four-colour G, Google's
// own words in the app's language.
//
// After a session: the SAME path as the email code — setActive, then the
// screen's onDone (the locked episode's screen replaces itself with the
// player, the Account tab re-renders signed in). A new Apple or Google
// account is a sign-up, and the hooks move between sign-in and sign-up
// (Clerk's transfer) themselves. Nothing about the person — no address, no
// name, no token, no Clerk text — is ever logged or shown; a development
// build warns with the failure's machine code only.

export const SOCIAL_BUTTON_HEIGHT = 48;
export const SOCIAL_BUTTON_RADIUS = 12;

export type SocialSignInProps = {
  // The form's own state, shared so the two ways in never run at once: one
  // `busy` for the email request and the provider sheet alike.
  ready: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  // The form's error line — the failure is shown and announced there.
  clearError: () => void;
  fail: (message: string) => void;
  onDone: () => void;
};

// What both Clerk hooks resolve with — the fields read here, structurally.
type FlowResult = {
  createdSessionId: string | null;
  setActive?: (params: { session: string }) => Promise<void>;
  signIn?: { id?: string; status?: string | null };
  signUp?: { id?: string; status?: string | null };
};

export function SocialSignIn(props: SocialSignInProps) {
  const t = useT();
  const config = useConfig();
  const lever = config.socialSignIn;
  // Asked once per mount, and only when the server wants Apple at all; no
  // button shows before the device has answered.
  const asksApple = Platform.OS === "ios" && lever?.apple === true;
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (!asksApple) return;
    let live = true;
    AppleAuthentication.isAvailableAsync().then(
      (available) => {
        if (live) setAppleAvailable(available);
      },
      // An unanswerable question is a «no»: the email form stays.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [asksApple]);

  const providers = socialProviders({
    os: Platform.OS,
    lever,
    appleAvailable,
    googleConfigured: googleSignInConfigured(Constants.expoConfig?.extra),
  });
  if (providers.length === 0) return null;

  return (
    <View style={styles.block}>
      <View style={styles.divider}>
        <View style={styles.rule} />
        <Text style={styles.dividerText}>{t.app.signIn.orContinueWith}</Text>
        <View style={styles.rule} />
      </View>
      <View style={styles.buttons}>
        {providers.map((provider) =>
          provider === "apple" ? (
            <AppleButton key="apple" {...props} />
          ) : (
            <GoogleButton key="google" {...props} />
          ),
        )}
      </View>
    </View>
  );
}

// One run of a provider's flow, start to finish. The legacy Clerk hooks
// THROW on failure (unlike the email form's future API, which resolves with
// `{ error }`), so this one is a try/catch.
function useSocialFlow(
  { ready, busy, setBusy, clearError, fail, onDone }: SocialSignInProps,
  provider: SocialProvider,
) {
  const t = useT();
  const clerk = useClerk();

  return async function run(start: () => Promise<FlowResult>) {
    if (busy || !ready) return;
    setBusy(true);
    clearError();
    // The witnesses classifySocialResult needs: which sign-in and sign-up
    // Clerk held before the tap.
    const before = {
      signInId: clerk.client?.signIn?.id,
      signUpId: clerk.client?.signUp?.id,
    };
    try {
      const result = await start();
      const outcome = classifySocialResult({
        createdSessionId: result.createdSessionId,
        before,
        signIn: result.signIn,
        signUp: result.signUp,
      });
      if (outcome === "signedIn" && result.createdSessionId) {
        const session = { session: result.createdSessionId };
        await (result.setActive ? result.setActive(session) : clerk.setActive(session));
        onDone();
      } else if (outcome === "incomplete") {
        fail(t.app.signIn.socialIncomplete);
      } else if (outcome === "failed") {
        fail(t.app.signIn.socialFailed);
      }
      // "cancelled": the viewer closed the sheet — the form as it was.
    } catch (e) {
      if (__DEV__) console.warn(`[matio] ${provider} sign-in failed: ${socialFailureCode(e) ?? "no code"}`);
      const kind = socialFailure(e);
      fail(
        kind === "network"
          ? t.app.account.stalledBody
          : kind === "rate_limited"
            ? t.app.signIn.tooManyRequests
            : t.app.signIn.socialFailed,
      );
    } finally {
      setBusy(false);
    }
  };
}

function AppleButton(props: SocialSignInProps) {
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const run = useSocialFlow(props, "apple");
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
      cornerRadius={SOCIAL_BUTTON_RADIUS}
      style={styles.appleButton}
      onPress={() => void run(() => startAppleAuthenticationFlow())}
    />
  );
}

function GoogleButton(props: SocialSignInProps) {
  const t = useT();
  const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
  const run = useSocialFlow(props, "google");
  return (
    <Pressable
      onPress={() => void run(() => startGoogleAuthenticationFlow())}
      accessibilityRole="button"
      aria-busy={props.busy}
      style={({ pressed }) => [styles.googleButton, pressed && { opacity: 0.85 }]}
    >
      {/* The G exactly as Google draws it: no tint. */}
      <Image source={googleG} style={styles.googleLogo} contentFit="contain" />
      <Text style={styles.googleLabel} numberOfLines={1}>
        {t.app.signIn.continueWithGoogle}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 20 pt under the gold CTA with the form's 8 pt gap; the buttons 14 pt
  // under the line and 10 pt apart — the board's spacing.
  block: { marginTop: space(3) },
  divider: { flexDirection: "row", alignItems: "center", gap: space(3) },
  rule: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { ...body, color: colors.inkDim, fontSize: 12, lineHeight: 16 },
  buttons: { marginTop: space(3.5), gap: space(2.5) },
  appleButton: { height: SOCIAL_BUTTON_HEIGHT, width: "100%" },
  googleButton: {
    height: SOCIAL_BUTTON_HEIGHT,
    borderRadius: SOCIAL_BUTTON_RADIUS,
    borderWidth: 1,
    borderColor: colors.googleStroke,
    backgroundColor: colors.googleSurface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2.5),
    paddingHorizontal: space(3),
  },
  googleLogo: { width: 20, height: 20 },
  // The system face at medium weight — Google's guide asks for Roboto
  // Medium, which the app does not ship; SF matches the Apple button above.
  googleLabel: { color: colors.googleText, fontSize: 15, fontWeight: "500" },
});
