import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Video from "react-native-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, muxStreamUrl } from "@/api/client";
import { useAsync } from "@/api/use-async";
import { ErrorState, GoldButton, Loading, Pill } from "@/components/ui";
import { body, colors, display, radius, SCREEN_PAD, space } from "@/theme";

// The player. Playback is only ever reached through /v1/playback-token, which
// returns a short-lived signed Mux JWT — a playback ID alone is never enough.
//
// Token-fetch failures branch into three DISTINCT end states, mirroring the
// web player. Collapsing them was a real web bug once: an infrastructure
// failure rendered as a paywall, telling users to pay for something that was
// merely broken.
export default function WatchScreen() {
  const { episodeId, title } = useLocalSearchParams<{
    episodeId: string;
    title?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [videoFailed, setVideoFailed] = useState(false);

  const playback = useAsync(
    useCallback(() => api.playbackToken(episodeId), [episodeId]),
    [episodeId],
  );

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
          message="Subscribers only"
          hint="This episode needs an active subscription."
          onRetry={playback.retry}
        />
      );
    }

    if (code === "rate_limited") {
      return (
        <ErrorState
          message="Too many previews this hour"
          hint="Try again a little later."
          onRetry={playback.retry}
        />
      );
    }

    return (
      <ErrorState message="Playback unavailable" hint={message} onRetry={playback.retry} />
    );
  }

  // A decode/network failure inside the video element is a different failure
  // from a token failure and must not be reported as one.
  if (videoFailed) {
    return (
      <ErrorState
        message="Playback unavailable"
        hint="The video couldn't be played."
        onRetry={() => {
          setVideoFailed(false);
          playback.retry();
        }}
      />
    );
  }

  const { playbackId, token } = playback.data;

  return (
    <View style={styles.stage}>
      <Video
        source={{ uri: muxStreamUrl(playbackId, token) }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        controls
        paused={false}
        onError={() => setVideoFailed(true)}
        // Keeps audio alive when the screen locks / app backgrounds. The full
        // now-playing + PiP treatment lands with phase 2.
        playInBackground={false}
        ignoreSilentSwitch="ignore"
      />

      <Pressable
        onPress={() => router.back()}
        style={[styles.back, { top: insets.top + space(2) }]}
        hitSlop={10}
      >
        <Text style={styles.backGlyph}>‹</Text>
      </Pressable>

      {title ? (
        <Text style={[styles.title, { top: insets.top + space(4) }]} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
    </View>
  );
}

function SignupWall({ onSignIn, onBack }: { onSignIn: () => void; onBack: () => void }) {
  return (
    <View style={styles.wall}>
      <Pill label="Keep watching free" />
      <Text style={styles.wallTitle}>Create your account</Text>
      <Text style={styles.wallCopy}>
        Create a free account to keep watching and save your progress across every series.
      </Text>
      <GoldButton
        label="Create free account"
        onPress={onSignIn}
        style={{ alignSelf: "stretch", marginTop: space(5) }}
      />
      <Pressable onPress={onBack} style={{ marginTop: space(5) }} hitSlop={8}>
        <Text style={styles.wallSecondary}>Not now</Text>
      </Pressable>
      <Text style={styles.wallFine}>No card needed. Just an email.</Text>
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
