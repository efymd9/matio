import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api/client";
import { useAsync } from "@/api/use-async";
import { useOptionalAuth } from "@/auth/clerk";
import { AuthStalled } from "@/components/auth-stalled";
import { SignInForm } from "@/components/sign-in-form";
import { Artwork, Scrim } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { goBackOrHome } from "@/navigation";
import { colors, SCREEN_PAD, space } from "@/theme";

// Set by the show page and Home's Play (watch/first-episode.ts: episodeRoute)
// — the locked episode the viewer tapped. The player's own wall passes none:
// the player is still under this screen.
type Params = { episodeId?: string; showSlug?: string };

// The show's frame over the form (#277, board variant B) when a locked
// episode sent the viewer here: its hero across the top, the form starting
// over the frame's faded foot. On a short phone (iPhone SE, 667 pt) the frame
// is smaller and the paddings tighter, so the email field, the CTA AND the
// Sign in with Apple button below it are all on screen without a scroll —
// the HIG wants Apple's button seen at once, and the board named the SE as
// the risk. Measured on react-native-web at 375×667 (PR #277).
const COMPACT_HEIGHT = 700;

function signInFrame(windowHeight: number): { height: number; overlap: number } {
  return windowHeight < COMPACT_HEIGHT ? { height: 160, overlap: 24 } : { height: 262, overlap: 30 };
}

// The sign-in screen a locked episode pushes (a screen of the root stack —
// no tab bar). The form itself is shared with the Account tab's signed-out
// state; this screen keeps the wall's «keep watching» framing and, on
// success, goes on to the episode rather than home.
export default function SignInScreen() {
  const router = useRouter();
  const { episodeId, showSlug } = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const t = useT();
  const { isLoaded, isSignedIn, stalled, retry } = useOptionalAuth();
  const back = useCallback(() => goBackOrHome(router), [router]);
  const compact = height < COMPACT_HEIGHT;

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

  // The frame's artwork and the episode's name. The frame's place is kept
  // from the first frame on (it depends on the slug alone), so nothing moves
  // when the show arrives — the tone gradient stands in meanwhile, and stays
  // if the load fails. The same CDN-cached read the show page just made.
  const frame = showSlug ? signInFrame(height) : null;
  const show = useAsync(
    () => (showSlug ? api.show(showSlug) : Promise.resolve(null)),
    [showSlug],
  );
  const episodes = show.data?.episodes ?? [];
  const position = episodeId ? episodes.findIndex((e) => e.id === episodeId) + 1 : 0;
  const kickerNote =
    position > 0 ? `${t.home.epShort(position)} · ${episodes[position - 1].title}` : undefined;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: frame ? 0 : insets.top + space(compact ? 6 : 10),
          paddingBottom: insets.bottom + space(compact ? 6 : 8),
        }}
        keyboardShouldPersistTaps="handled"
      >
        {frame && showSlug ? (
          <View style={{ height: frame.height }} testID="show-frame">
            <Artwork
              uri={show.data ? (show.data.heroImageUrl ?? show.data.posterImageUrl) : null}
              toneKey={showSlug}
              style={StyleSheet.absoluteFill}
              displayWidth={width}
            />
            <Scrim height={frame.height * 0.72} from="bottom" />
            <Scrim height={insets.top + space(16)} from="top" maxOpacity={0.7} />
          </View>
        ) : null}

        <View
          style={[
            styles.body,
            frame ? { marginTop: -frame.overlap } : styles.centred,
          ]}
        >
          {/* While Clerk loads the form renders with its CTA inert, as before;
              once the hook gives up on Clerk (#253) the form would never work,
              so the honest state takes its place — with the way back. */}
          {!isLoaded && stalled ? (
            <AuthStalled onRetry={retry} onCancel={back} />
          ) : (
            <SignInForm
              kicker={t.signupWall.kicker}
              kickerNote={kickerNote}
              headline={t.signupWall.headline}
              bodyText={t.signupWall.bodyNoCount}
              cta={t.app.signIn.sendCode}
              onDone={done}
              onCancel={back}
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: SCREEN_PAD },
  centred: { flexGrow: 1, justifyContent: "center" },
});

// A render crash here is this screen's, not the app's (#308): Back / Try
// again instead of RCTFatal. See components/route-error.tsx.
export { RouteErrorBoundary as ErrorBoundary } from "@/components/route-error";
