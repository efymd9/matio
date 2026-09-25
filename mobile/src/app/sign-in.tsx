import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOptionalAuth } from "@/auth/clerk";
import { AuthStalled } from "@/components/auth-stalled";
import { SignInForm } from "@/components/sign-in-form";
import { useT } from "@/i18n/locale";
import { goBackOrHome } from "@/navigation";
import { colors, SCREEN_PAD, space } from "@/theme";

// Set by the show page and Home's Play (watch/first-episode.ts: episodeRoute)
// — the locked episode the viewer tapped. The player's own wall passes none:
// the player is still under this screen.
type Params = { episodeId?: string; showSlug?: string };

// The sign-in screen a locked episode pushes (a screen of the root stack —
// no tab bar). The form itself is shared with the Account tab's signed-out
// state; this screen keeps the wall's «keep watching» framing and, on
// success, goes on to the episode rather than home.
export default function SignInScreen() {
  const router = useRouter();
  const { episodeId, showSlug } = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { isLoaded, isSignedIn, stalled, retry } = useOptionalAuth();
  const back = useCallback(() => goBackOrHome(router), [router]);

  // Signed in — by this form, or by a Clerk that finished loading a session
  // after the screen opened (a slow start can push a signed-in viewer here) —
  // the viewer goes on to the episode that sent them, now unlocked: in place
  // of this screen when the show page or Home named it, back to the player
  // when its wall did. Exactly once: the form's onDone and the isSignedIn
  // flip report the same success.
  const doneRef = useRef(false);
  const done = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (episodeId && showSlug) {
      router.replace({ pathname: "/watch/[episodeId]", params: { episodeId, showSlug } });
    } else {
      goBackOrHome(router);
    }
  }, [episodeId, showSlug, router]);

  useEffect(() => {
    if (isSignedIn) done();
  }, [isSignedIn, done]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + space(10), paddingBottom: insets.bottom + space(8) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* While Clerk loads the form renders with its CTA inert, as before;
            once the hook gives up on Clerk (#253) the form would never work,
            so the honest state takes its place — with the way back. */}
        {!isLoaded && stalled ? (
          <AuthStalled onRetry={retry} onCancel={back} />
        ) : (
          <SignInForm
            kicker={t.signupWall.kicker}
            headline={t.signupWall.headline}
            bodyText={t.signupWall.bodyNoCount}
            cta={t.app.signIn.sendCode}
            onDone={done}
            onCancel={back}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: SCREEN_PAD,
  },
});
