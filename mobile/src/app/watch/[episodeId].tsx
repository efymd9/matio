import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Video, { type VideoRef } from "react-native-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, muxStreamUrl } from "@/api/client";
import { useAsync } from "@/api/use-async";
import { useOptionalAuth } from "@/auth/clerk";
import { ErrorState, GoldButton, Loading, Pill } from "@/components/ui";
import { VerticalChrome } from "@/components/vertical-chrome";
import { useT } from "@/i18n/locale";
import { body, colors, display, radius, SCREEN_PAD, space } from "@/theme";
import { useProgressSaver } from "@/watch/use-progress-saver";

// The player. Playback is only ever reached through /v1/playback-token, which
// returns a short-lived signed Mux JWT — a playback ID alone is never enough.
//
// Token-fetch failures branch into three DISTINCT end states, mirroring the
// web player. Collapsing them was a real web bug once: an infrastructure
// failure rendered as a paywall, telling users to pay for something that was
// merely broken.
//
// Two chromes, one engine — the web's rule for vertical shows: a
// `shows.orientation === "vertical"` episode fills the screen edge to edge
// under our own TikTok-style controls (VerticalChrome); everything else keeps
// the native transport, letterboxed.

// A resume target inside the last seconds is a finished episode: start over
// rather than land on the credits.
const RESUME_TAIL_SECONDS = 10;

type Params = {
  episodeId: string;
  title?: string;
  showTitle?: string;
  orientation?: string;
  episodeNumber?: string;
  // Seconds; set by the continue-watching tile. Without it a signed-in
  // viewer's position is looked up from /v1/continue.
  resume?: string;
};

function parseSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

// The position to open at. An explicit `resume` param (the rail's tap) wins;
// otherwise a signed-in viewer's own continue-watching row is consulted —
// best-effort and in parallel with the token, so a failed lookup costs
// nothing but the resume.
async function resolveResume(
  episodeId: string,
  explicit: number | null,
  signedIn: boolean,
): Promise<number> {
  if (explicit !== null) return explicit;
  if (!signedIn) return 0;
  try {
    const { items } = await api.continueWatching();
    return items.find((item) => item.episodeId === episodeId)?.positionSeconds ?? 0;
  } catch {
    return 0;
  }
}

export default function WatchScreen() {
  const params = useLocalSearchParams<Params>();
  const { episodeId } = params;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { isSignedIn } = useOptionalAuth();
  const vertical = params.orientation === "vertical";
  const episodeNumber = parseSeconds(params.episodeNumber);
  const explicitResume = parseSeconds(params.resume);

  const [videoFailed, setVideoFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  // Read by the vertical chrome only; the native transport draws its own.
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<VideoRef>(null);
  const endedRef = useRef(false);

  // Read at fetch time, not a dependency: Clerk may finish loading a beat
  // after mount, and re-running the fetch on that flip would remount the
  // player mid-start.
  const signedInRef = useRef(isSignedIn);
  signedInRef.current = isSignedIn;

  const saver = useProgressSaver(episodeId, isSignedIn);

  const playback = useAsync(
    useCallback(async () => {
      const [token, resumeSeconds] = await Promise.all([
        api.playbackToken(episodeId),
        resolveResume(episodeId, explicitResume, signedInRef.current),
      ]);
      return { ...token, resumeSeconds };
    }, [episodeId, explicitResume]),
    [episodeId, explicitResume],
  );

  const togglePlay = useCallback(() => {
    if (endedRef.current) {
      // Un-ending: the element sits at the end, so a bare play would do
      // nothing. Seek home first; onProgress then clears the saver's ended
      // flag as the playhead moves back.
      endedRef.current = false;
      videoRef.current?.seek(0);
      setPaused(false);
      return;
    }
    setPaused((p) => !p);
  }, []);

  if (playback.status === "loading") return <Loading />;

  if (playback.status === "error") {
    const { code, reason, message } = playback.error;

    // 403 signup_required — the positional gate. Not an error; an ask.
    if (code === "forbidden" && reason === "signup_required") {
      return <SignupWall onSignIn={() => router.push("/sign-in")} onBack={() => router.back()} />;
    }

    // 403 subscribe_required — paid mode only, dormant while payments are off.
    if (code === "forbidden" && reason === "subscribe_required") {
      return (
        <ErrorState
          message={t.app.watch.subscribersOnly}
          hint={t.app.watch.subscribersOnlyHint}
          onRetry={playback.retry}
        />
      );
    }

    if (code === "rate_limited") {
      return (
        <ErrorState
          message={t.watch.rateLimitedKicker}
          hint={t.watch.rateLimitedTitle}
          onRetry={playback.retry}
        />
      );
    }

    return (
      <ErrorState message={t.watch.unavailableKicker} hint={message} onRetry={playback.retry} />
    );
  }

  // A decode/network failure inside the video element is a different failure
  // from a token failure and must not be reported as one.
  if (videoFailed) {
    return (
      <ErrorState
        message={t.watch.unavailableKicker}
        hint={t.watch.unavailableTitle}
        onRetry={() => {
          setVideoFailed(false);
          playback.retry();
        }}
      />
    );
  }

  const { playbackId, token, resumeSeconds } = playback.data;

  return (
    <View style={styles.stage}>
      <Video
        ref={videoRef}
        source={{ uri: muxStreamUrl(playbackId, token) }}
        style={StyleSheet.absoluteFill}
        // Vertical shows fill the portrait screen; landscape ones letterbox.
        resizeMode={vertical ? "cover" : "contain"}
        controls={!vertical}
        paused={paused}
        muted={muted}
        // One sample a second is plenty for a save every ten and a progress
        // bar that moves; the default 250ms would re-render the chrome 4×/s.
        progressUpdateInterval={1000}
        onLoad={(e) => {
          setDuration(e.duration);
          // Land on the saved position once the stream knows its length —
          // never inside the credits.
          if (resumeSeconds > 0 && resumeSeconds < e.duration - RESUME_TAIL_SECONDS) {
            videoRef.current?.seek(resumeSeconds);
          }
        }}
        onProgress={(e) => {
          saver.onProgress(e.currentTime);
          if (vertical) setPosition(e.currentTime);
        }}
        onEnd={() => {
          endedRef.current = true;
          saver.onEnded();
          // Our own chrome shows the play glyph again; the native transport
          // handles its own end state.
          if (vertical) setPaused(true);
        }}
        onError={() => setVideoFailed(true)}
        // Keeps audio alive when the screen locks / app backgrounds. The full
        // now-playing + PiP treatment lands with phase 2.
        playInBackground={false}
        ignoreSilentSwitch="ignore"
      />

      {vertical ? (
        <VerticalChrome
          showTitle={params.showTitle ?? params.title ?? ""}
          episodeTitle={params.title ?? ""}
          episodeNumber={episodeNumber}
          positionSeconds={position}
          durationSeconds={duration}
          paused={paused}
          muted={muted}
          onTogglePlay={togglePlay}
          onToggleMute={() => setMuted((m) => !m)}
          onBack={() => router.back()}
        />
      ) : (
        <>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t.player.backToShowAria}
            style={[styles.back, { top: insets.top + space(2) }]}
            hitSlop={10}
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>

          {params.title ? (
            <Text style={[styles.title, { top: insets.top + space(4) }]} numberOfLines={1}>
              {params.title}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function SignupWall({ onSignIn, onBack }: { onSignIn: () => void; onBack: () => void }) {
  const t = useT();
  return (
    <View style={styles.wall}>
      <Pill label={t.signupWall.kicker} />
      <Text style={styles.wallTitle}>{t.signupWall.headline}</Text>
      <Text style={styles.wallCopy}>{t.signupWall.bodyNoCount}</Text>
      <GoldButton
        label={t.signupWall.signUpCta}
        onPress={onSignIn}
        style={{ alignSelf: "stretch", marginTop: space(5) }}
      />
      <Pressable onPress={onBack} style={{ marginTop: space(5) }} hitSlop={8}>
        <Text style={styles.wallSecondary}>{t.app.common.notNow}</Text>
      </Pressable>
      <Text style={styles.wallFine}>{t.signupWall.noCardNeeded}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: "#000" },
  back: {
    position: "absolute",
    left: SCREEN_PAD,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: { color: colors.ink, fontSize: 28, lineHeight: 30, marginTop: -2 },
  title: {
    position: "absolute",
    left: SCREEN_PAD + 52,
    right: SCREEN_PAD,
    ...display,
    color: colors.ink,
    fontSize: 13,
    letterSpacing: 0.4,
  },
  wall: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    paddingHorizontal: SCREEN_PAD,
    gap: space(2),
  },
  wallTitle: { ...display, color: colors.ink, fontSize: 34, lineHeight: 38, marginTop: space(2) },
  wallCopy: { ...body, color: colors.inkMuted, fontSize: 14, lineHeight: 21 },
  wallSecondary: { ...body, color: colors.gold, fontSize: 14, textAlign: "center" },
  wallFine: {
    ...body,
    color: colors.inkDim,
    fontSize: 12,
    textAlign: "center",
    marginTop: space(6),
  },
});
