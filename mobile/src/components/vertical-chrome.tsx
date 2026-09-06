import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "@/i18n/locale";
import { body, colors, display, fonts, radius, SCREEN_PAD, space } from "@/theme";

// TikTok-style minimal chrome for vertical (portrait) shows — the app's twin
// of components/watch/vertical-chrome.tsx on the web, by intent: the video
// fills the screen edge to edge, the whole surface is the play/pause target,
// a bottom-left block carries title / episode / progress, and a right rail
// holds the one essential control (sound). The native transport is switched
// off for these shows (`controls={false}`); everything here is ours.
//
// Layering: the full-surface toggle underneath; the top and bottom bars over
// it with pointer events only on their buttons, so a tap on empty gradient
// still toggles playback.
export function VerticalChrome({
  showTitle,
  episodeTitle,
  episodeNumber,
  positionSeconds,
  durationSeconds,
  paused,
  muted,
  onTogglePlay,
  onToggleMute,
  onBack,
}: {
  showTitle: string;
  episodeTitle: string;
  episodeNumber: number | null;
  positionSeconds: number;
  durationSeconds: number;
  paused: boolean;
  muted: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();

  const fraction = durationSeconds > 0 ? Math.min(1, positionSeconds / durationSeconds) : 0;
  const minutes = durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : null;
  const meta = [
    episodeNumber !== null ? t.home.epShort(episodeNumber) : null,
    episodeTitle,
    minutes !== null ? t.episodesOverlay.minutes(minutes) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* Full-surface play/pause. The glyph shows only while paused, so
          nothing overlays the picture during playback. */}
      <Pressable
        onPress={onTogglePlay}
        accessibilityRole="button"
        accessibilityLabel={t.player.playPauseAria}
        style={StyleSheet.absoluteFill}
      >
        {paused ? (
          <View style={styles.centre} pointerEvents="none">
            <LinearGradient
              colors={[colors.goldHi, colors.goldLo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.playDisc}
            >
              <View style={styles.playGlyph} />
            </LinearGradient>
          </View>
        ) : null}
      </Pressable>

      {/* Top bar — back. */}
      <LinearGradient
        pointerEvents="box-none"
        colors={["rgba(0,0,0,0.7)", "rgba(0,0,0,0.25)", "rgba(0,0,0,0)"]}
        style={[styles.topBar, { paddingTop: insets.top + space(3) }]}
      >
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t.player.backToShowAria}
          hitSlop={10}
          style={({ pressed }) => [styles.roundButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
      </LinearGradient>

      {/* Bottom block — title / meta / progress (left) + rail (right). */}
      <LinearGradient
        pointerEvents="box-none"
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.3)", "rgba(0,0,0,0.85)"]}
        style={[styles.bottomBar, { paddingBottom: insets.bottom + space(4) }]}
      >
        <View style={styles.infoBlock} pointerEvents="none">
          <View style={styles.kickerRow}>
            <View style={styles.kickerTick} />
            <Text style={styles.kicker}>{t.hero.matioOriginal}</Text>
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {showTitle}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
          </View>
          <View style={styles.times}>
            <Text style={styles.time}>{formatTime(positionSeconds)}</Text>
            <Text style={styles.time}>{durationSeconds > 0 ? formatTime(durationSeconds) : ""}</Text>
          </View>
        </View>

        <View style={styles.rail}>
          <Pressable
            onPress={onToggleMute}
            accessibilityRole="button"
            accessibilityLabel={t.player.muteAria}
            accessibilityState={{ selected: muted }}
            hitSlop={8}
            style={({ pressed }) => [styles.roundButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.railGlyph}>♪</Text>
            {muted ? <View style={styles.slash} /> : null}
          </Pressable>
        </View>
      </LinearGradient>
    </>
  );
}

// "M:SS" — the read-outs under the progress bar.
function formatTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const BUTTON = 40;

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  playDisc: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  // Triangle via borders, same trick as the gold CTA — no icon dependency.
  playGlyph: {
    marginLeft: 6,
    width: 0,
    height: 0,
    borderTopWidth: 14,
    borderBottomWidth: 14,
    borderLeftWidth: 24,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: colors.goldDeep,
  },
  topBar: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: SCREEN_PAD,
    paddingBottom: space(12),
    flexDirection: "row",
    alignItems: "flex-start",
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space(16),
    paddingHorizontal: SCREEN_PAD,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space(3.5),
  },
  infoBlock: { flex: 1, minWidth: 0 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  kickerTick: { width: 12, height: 2, borderRadius: 1, backgroundColor: colors.rust },
  kicker: { ...display, color: colors.gold, fontSize: 9, letterSpacing: 1.8 },
  title: {
    ...display,
    color: colors.ink,
    fontSize: 22,
    // RN clips to lineHeight — see the hero note in app/index.tsx.
    lineHeight: 26,
    marginTop: space(2),
  },
  meta: { ...body, color: colors.inkMuted, fontSize: 12, marginTop: space(1.5) },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.glass,
    marginTop: space(2.5),
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: colors.gold },
  times: { flexDirection: "row", justifyContent: "space-between", marginTop: space(1.5) },
  time: { fontFamily: fonts.mono, color: colors.inkDim, fontSize: 10 },
  // The rail floats above the block's baseline, as on the web (9b spec).
  rail: { alignItems: "center", gap: space(3), paddingBottom: 34 },
  roundButton: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: { color: colors.ink, fontSize: 28, lineHeight: 30, marginTop: -2 },
  railGlyph: { color: colors.ink, fontSize: 18, lineHeight: 22 },
  slash: {
    position: "absolute",
    width: 2,
    height: 24,
    borderRadius: 1,
    backgroundColor: colors.rust,
    transform: [{ rotate: "45deg" }],
  },
});
