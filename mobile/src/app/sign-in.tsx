import { useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOptionalAuth } from "@/auth/clerk";
import { AuthStalled } from "@/components/auth-stalled";
import { SignInForm } from "@/components/sign-in-form";
import { useT } from "@/i18n/locale";
import { colors, SCREEN_PAD, space } from "@/theme";

// The sign-in screen a locked episode pushes (a screen of the root stack —
// no tab bar). The form itself is shared with the Account tab's signed-out
// state; this screen keeps the wall's «keep watching» framing and, on
// success, goes BACK rather than home: the viewer came from an episode and
// should land on it, now unlocked.
export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { isLoaded, stalled, retry } = useOptionalAuth();
  const back = () => router.back();

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
            onDone={back}
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
