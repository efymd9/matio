import { Image } from "expo-image";
import { useMemo, useRef } from "react";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useT } from "@/i18n/locale";
import { colors, radius } from "@/theme";
import { tileAt, type Storyboard } from "@/watch/storyboard";

// The landscape player's scrub bar (#375, board E «Стекло»): a 4pt rail with
// the gold fill and a 14pt cream knob that grows ×1.35 while it is dragged.
// The drag is reported, not acted on — the chrome shows the preview while it
// lasts and seeks once, on release. To VoiceOver it is one adjustable element
// whose value is the time («6:12 of 16:00»): swipe up / down = ±10 s.

export const SCRUB_STEP_SECONDS = 10;
const KNOB = 14;
const KNOB_SCRUBBING = 1.35;
const ignoreActivate = () => {};

// "M:SS", or "H:MM:SS" past the hour — the bar's read-outs.
export function formatTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function ScrubBar({
  positionSeconds,
  durationSeconds,
  scrubSeconds,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
  onStep,
  onTrackLayout,
}: {
  positionSeconds: number;
  durationSeconds: number;
  // The dragged-to time while a drag lasts, else null.
  scrubSeconds: number | null;
  onScrubStart: (seconds: number) => void;
  onScrubMove: (seconds: number) => void;
  onScrubEnd: (seconds: number) => void;
  // VoiceOver's increment / decrement.
  onStep: (deltaSeconds: number) => void;
  // Where the rail sits inside the bar — the chrome hangs the preview over it.
  onTrackLayout: (track: { x: number; width: number }) => void;
}) {
  const t = useT();
  const widthRef = useRef(0);
  const startXRef = useRef(0);
  // The responder below is created once; it reads the latest of these.
  const live = useRef({ durationSeconds, onScrubStart, onScrubMove, onScrubEnd });
  live.current = { durationSeconds, onScrubStart, onScrubMove, onScrubEnd };

  const pan = useMemo(() => {
    const at = (x: number) => {
      const width = widthRef.current;
      const fraction = width > 0 ? Math.min(1, Math.max(0, x / width)) : 0;
      return fraction * live.current.durationSeconds;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => live.current.durationSeconds > 0,
      onMoveShouldSetPanResponder: () => live.current.durationSeconds > 0,
      // A drag along the bar is the bar's until the finger lifts.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startXRef.current = e.nativeEvent.locationX;
        live.current.onScrubStart(at(startXRef.current));
      },
      onPanResponderMove: (_, g) => live.current.onScrubMove(at(startXRef.current + g.dx)),
      onPanResponderRelease: (_, g) => live.current.onScrubEnd(at(startXRef.current + g.dx)),
      onPanResponderTerminate: (_, g) => live.current.onScrubEnd(at(startXRef.current + g.dx)),
    });
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    widthRef.current = width;
    onTrackLayout({ x, width });
  };

  const shown = scrubSeconds ?? positionSeconds;
  const fraction = durationSeconds > 0 ? Math.min(1, Math.max(0, shown / durationSeconds)) : 0;

  return (
    <View
      testID="scrub-bar"
      onLayout={onLayout}
      style={styles.hit}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t.app.player.position}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationSeconds)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={t.app.player.positionValue(formatTime(shown), formatTime(durationSeconds))}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment") onStep(SCRUB_STEP_SECONDS);
        if (e.nativeEvent.actionName === "decrement") onStep(-SCRUB_STEP_SECONDS);
      }}
      // A VoiceOver double tap on the bar does nothing. Without a handler
      // iOS answers it with a synthetic touch at the element's centre, and
      // the responder below would take that for a drag to the middle of the
      // episode; with one, accessibilityActivate is handled and no touch is
      // sent.
      onAccessibilityTap={ignoreActivate}
      {...pan.panHandlers}
    >
      {/* Nothing inside takes a touch: the bar itself is the target, so a
          grant's locationX is always measured from the rail's left end. */}
      <View style={styles.rail} pointerEvents="none">
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.knob,
          { left: `${fraction * 100}%` },
          scrubSeconds !== null && styles.knobScrubbing,
        ]}
      />
    </View>
  );
}

// One storyboard tile, cut out of its sprite: the sprite drawn at its full
// size, scaled to the tile's, behind a window the size of the frame.
export function StoryboardFrame({
  board,
  seconds,
  width,
  height,
}: {
  board: Storyboard;
  seconds: number;
  width: number;
  height: number;
}) {
  const tile = tileAt(board, seconds);
  const sprite = board.sprites[tile.url];
  const sx = width / tile.width;
  const sy = height / tile.height;
  return (
    <View testID="storyboard-frame" style={[styles.frame, { width, height }]}>
      <Image
        source={{ uri: tile.url }}
        contentFit="fill"
        style={{
          position: "absolute",
          left: -tile.x * sx,
          top: -tile.y * sy,
          width: sprite.width * sx,
          height: sprite.height * sy,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // 44pt tall for the finger; the rail is 4pt in its middle.
  hit: { flex: 1, minWidth: 0, height: 44, justifyContent: "center", marginHorizontal: 4 },
  rail: { height: 4, borderRadius: 2, backgroundColor: colors.inkFaint, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.gold },
  knob: {
    position: "absolute",
    top: (44 - KNOB) / 2,
    width: KNOB,
    height: KNOB,
    marginLeft: -KNOB / 2,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  knobScrubbing: { transform: [{ scale: KNOB_SCRUBBING }] },
  frame: { overflow: "hidden", borderRadius: radius.thumb, backgroundColor: colors.card },
});
