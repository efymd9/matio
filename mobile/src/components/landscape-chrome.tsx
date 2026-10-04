import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EpisodesPanel, type PanelEpisode } from "@/components/episodes-panel";
import { GlassSurface, GoldGlass } from "@/components/glass";
import { Icon, type IconName } from "@/components/icon";
import { formatTime, ScrubBar, StoryboardFrame } from "@/components/scrub-bar";
import { Artwork } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { colors, display, fonts, radius } from "@/theme";
import type { Storyboard } from "@/watch/storyboard";

// The landscape player's own chrome (#375) — board E «Стекло», the owner's
// pick of 04.10: the family of the floating tab bar (B1), not of the web
// player. Three glass capsules float over the picture with NO scrims — the
// video shows through the glass:
//
//   top left   «‹» + the show (display face, caps) + «Ep. 2 · Title»
//   top right  picture-in-picture
//   bottom     a B1-shaped bar: the gold play/pause pill with its label,
//              −10 / +10, elapsed, the scrub bar, remaining, Episodes, Next
//
// Liquid Glass on iOS 26+, the translucent espresso elsewhere — both from
// components/glass.tsx, like the bar. The native transport is OFF on these
// pages (`controls={false}`), so everything a viewer can do is here.
//
// Taps: one tap on the picture shows or hides the chrome, which hides itself
// 4 s into playback; a double tap on the left or right third is −10 / +10 with
// a mark on screen. Persistent pieces live outside the chrome: the buffering
// disc, «Skip intro» (only for an episode with intro marks), the end-of-episode
// card and the episodes panel.
//
// VoiceOver: while the chrome is hidden it is not in the tree — nothing
// invisible to focus — and while a screen reader runs the chrome simply
// stays up. Magic Tap toggles playback, as in every player on iOS.

export const AUTO_HIDE_MS = 4_000;
export const DOUBLE_TAP_MS = 300;
// The end card's window: it appears this long before the end, and with
// autoplay on its ring counts the same seconds down to the advance.
export const END_CARD_SECONDS = 10;
const SEEK_STEP_SECONDS = 10;
const MARK_MS = 750;

// The board's geometry (pt). Capsules keep 6pt from the safe area on the
// sides — the notch / Dynamic Island strip — and 12pt from the top; the bar
// sits 8pt over the bottom inset, like B1 over the home indicator.
const SIDE = 6;
const TOP = 12;
const CAPSULE_H = 50;
const BAR_H = 64;
const BAR_BOTTOM = 8;
// «Skip intro» and the end card stand just over the bar.
const ABOVE_BAR = BAR_BOTTOM + BAR_H + 12;
const PREVIEW_W = 170;
const PREVIEW_H = 96;
const PREVIEW_PAD = 6;
const TIME_ONLY_W = 72;

export type UpNext = {
  number: number;
  title: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  toneKey: string;
};

type Zone = "left" | "centre" | "right";

export function LandscapeChrome({
  showTitle,
  episodeTitle,
  episodeNumber,
  positionSeconds,
  durationSeconds,
  paused,
  buffering,
  intro,
  upNext,
  autoplay,
  endDismissed,
  storyboard,
  episodes,
  seasonNumber,
  onTogglePlay,
  onSeek,
  onBack,
  onPip,
  onNext,
  onDismissEnd,
  onSelectEpisode,
}: {
  showTitle: string;
  episodeTitle: string;
  episodeNumber: number;
  positionSeconds: number;
  durationSeconds: number;
  // The viewer's own pause (the feed's `userPaused`).
  paused: boolean;
  buffering: boolean;
  // The episode's «Skip intro» window; null without marks.
  intro: { start: number; end: number } | null;
  // The next episode — null on the last one (no end card, no Next).
  upNext: UpNext | null;
  // Settings → Playback → «Play next episode automatically».
  autoplay: boolean;
  // The viewer pressed Cancel on this ending's card.
  endDismissed: boolean;
  storyboard: Storyboard | null;
  episodes: PanelEpisode[];
  seasonNumber: number;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onBack: () => void;
  onPip: () => void;
  onNext: () => void;
  onDismissEnd: () => void;
  onSelectEpisode: (index: number) => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const screenReader = useScreenReaderEnabled();

  const [visible, setVisible] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [mark, setMark] = useState<{ side: "left" | "right"; at: number } | null>(null);
  const [track, setTrack] = useState<{ x: number; width: number } | null>(null);
  // Bumped by every press: restarts the auto-hide countdown.
  const [armed, setArmed] = useState(0);

  // A pause — the viewer's, the lock screen's, the end of the episode —
  // brings the chrome back, so a stopped picture always has its controls.
  // (A render-phase adjustment, not an effect.)
  const [wasPaused, setWasPaused] = useState(paused);
  if (paused !== wasPaused) {
    setWasPaused(paused);
    if (paused) setVisible(true);
  }

  const hasDuration = durationSeconds > 0;
  const shown = scrub ?? positionSeconds;
  const inEndWindow =
    upNext !== null && hasDuration && positionSeconds >= durationSeconds - END_CARD_SECONDS;
  const endCard = inEndWindow && !endDismissed && !panelOpen && scrub === null;
  const controls = (visible || screenReader) && !endCard && !panelOpen;
  const introOn =
    intro !== null &&
    positionSeconds >= intro.start &&
    positionSeconds < intro.end &&
    !endCard &&
    !panelOpen;

  useEffect(() => {
    if (!controls || paused || buffering || scrub !== null || screenReader) return;
    const timer = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [controls, paused, buffering, scrub, screenReader, armed]);

  useEffect(() => {
    if (mark === null) return;
    const timer = setTimeout(() => setMark(null), MARK_MS);
    return () => clearTimeout(timer);
  }, [mark]);

  const poke = () => {
    setVisible(true);
    setArmed((n) => n + 1);
  };

  // Never past the last second: a seek onto the very end would end the
  // episode from a tap meant to skip ahead.
  const clampSeek = (seconds: number) =>
    Math.max(0, hasDuration ? Math.min(seconds, Math.max(0, durationSeconds - 1)) : seconds);
  const seekBy = (delta: number) => onSeek(clampSeek(positionSeconds + delta));

  // The picture's three tap zones. The middle toggles at once; a side waits
  // DOUBLE_TAP_MS for a second tap — two make a ±10 (and a third, another).
  const lastTapRef = useRef<{ zone: Zone; at: number } | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
    },
    [],
  );
  const onZoneTap = (zone: Zone) => {
    if (panelOpen) {
      setPanelOpen(false);
      return;
    }
    const now = Date.now();
    const last = lastTapRef.current;
    lastTapRef.current = { zone, at: now };
    if (zone !== "centre" && last?.zone === zone && now - last.at < DOUBLE_TAP_MS) {
      if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      seekBy(zone === "left" ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS);
      setMark({ side: zone, at: now });
      return;
    }
    if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
    const toggle = () => {
      setVisible((v) => !v);
      setArmed((n) => n + 1);
    };
    if (zone === "centre") {
      tapTimerRef.current = null;
      toggle();
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      toggle();
    }, DOUBLE_TAP_MS);
  };

  const barLeft = insets.left + SIDE;
  const count = hasDuration ? Math.max(0, Math.ceil(durationSeconds - positionSeconds)) : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onMagicTap={onTogglePlay}>
      {/* The picture: three tap zones, invisible to VoiceOver — a screen
          reader keeps the chrome up, so there is nothing to reveal. */}
      <View style={styles.zones}>
        {(["left", "centre", "right"] as const).map((zone) => (
          <Pressable
            key={zone}
            testID={`tap-${zone}`}
            accessible={false}
            importantForAccessibility="no"
            onPress={() => onZoneTap(zone)}
            style={zone === "centre" ? styles.zoneCentre : styles.zoneSide}
          />
        ))}
      </View>

      {mark ? (
        <View
          pointerEvents="none"
          aria-hidden
          style={[styles.markZone, mark.side === "left" ? styles.markLeft : styles.markRight]}
        >
          <GlassSurface style={styles.mark}>
            <Icon name={mark.side === "left" ? "back10" : "forward10"} size={26} color={colors.ink} />
            <Text style={styles.markText} maxFontSizeMultiplier={TEXT_CAP}>
              {t.app.player.tenSeconds}
            </Text>
          </GlassSurface>
        </View>
      ) : null}

      {buffering ? (
        <View style={styles.centre} pointerEvents="none">
          <GlassSurface style={styles.bufferDisc}>
            <ActivityIndicator size="large" color={colors.gold} />
          </GlassSurface>
        </View>
      ) : null}

      {controls ? (
        <View testID="landscape-controls" style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {paused && !buffering ? (
            <View style={styles.centre} pointerEvents="box-none">
              <Pressable
                onPress={() => {
                  onTogglePlay();
                  poke();
                }}
                accessibilityRole="button"
                accessibilityLabel={t.hero.play}
              >
                <GlassSurface interactive style={styles.playDisc}>
                  <View style={styles.playNudge}>
                    <Icon name="play" size={30} color={colors.ink} />
                  </View>
                </GlassSurface>
              </Pressable>
            </View>
          ) : null}

          <View
            testID="capsule-title"
            style={[styles.topLeft, { top: insets.top + TOP, left: insets.left + SIDE }]}
          >
            <GlassSurface interactive style={styles.titleCapsule}>
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel={t.player.backToShowAria}
                hitSlop={6}
                style={({ pressed }) => [styles.backDisc, pressed && styles.pressed]}
              >
                <Text style={styles.backGlyph}>‹</Text>
              </Pressable>
              <View style={styles.titles}>
                <Text style={styles.showTitle} numberOfLines={1} maxFontSizeMultiplier={TEXT_CAP}>
                  {showTitle}
                </Text>
                <Text style={styles.episodeLine} numberOfLines={1} maxFontSizeMultiplier={TEXT_CAP}>
                  {`${t.home.epShort(episodeNumber)} · ${episodeTitle}`}
                </Text>
              </View>
            </GlassSurface>
          </View>

          <View
            testID="capsule-pip"
            style={[styles.topRight, { top: insets.top + TOP, right: insets.right + SIDE }]}
          >
            <GlassSurface interactive style={styles.pipCapsule}>
              <IconButton
                icon="pip"
                label={t.app.player.pip}
                onPress={() => {
                  onPip();
                  poke();
                }}
              />
            </GlassSurface>
          </View>

          <View
            testID="capsule-bar"
            style={[
              styles.barWrap,
              { left: barLeft, right: insets.right + SIDE, bottom: insets.bottom + BAR_BOTTOM },
            ]}
          >
            <GlassSurface style={styles.bar}>
              <Pressable
                onPress={() => {
                  onTogglePlay();
                  poke();
                }}
                accessibilityRole="button"
                accessibilityLabel={t.player.playPauseAria}
                aria-valuetext={paused ? t.app.player.paused : t.app.player.playing}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <GoldGlass interactive style={styles.pill}>
                  {buffering ? (
                    <ActivityIndicator size="small" color={colors.goldDeep} />
                  ) : (
                    <Icon name={paused ? "play" : "pause"} size={16} color={colors.goldDeep} />
                  )}
                  <Text style={styles.pillLabel} numberOfLines={1} maxFontSizeMultiplier={TEXT_CAP}>
                    {paused ? t.hero.play : t.app.player.pause}
                  </Text>
                </GoldGlass>
              </Pressable>
              <IconButton
                icon="back10"
                label={t.player.back10Aria}
                onPress={() => {
                  seekBy(-SEEK_STEP_SECONDS);
                  poke();
                }}
              />
              <IconButton
                icon="forward10"
                label={t.player.forward10Aria}
                onPress={() => {
                  seekBy(SEEK_STEP_SECONDS);
                  poke();
                }}
              />
              <Text style={styles.time} maxFontSizeMultiplier={TEXT_CAP}>
                {formatTime(shown)}
              </Text>
              <ScrubBar
                positionSeconds={positionSeconds}
                durationSeconds={durationSeconds}
                scrubSeconds={scrub}
                onScrubStart={(seconds) => {
                  setScrub(seconds);
                  setVisible(true);
                }}
                onScrubMove={setScrub}
                onScrubEnd={(seconds) => {
                  setScrub(null);
                  onSeek(clampSeek(seconds));
                  poke();
                }}
                onStep={(delta) => {
                  seekBy(delta);
                  poke();
                }}
                onTrackLayout={setTrack}
              />
              <Text style={[styles.time, styles.timeLeft]} maxFontSizeMultiplier={TEXT_CAP}>
                {hasDuration ? `−${formatTime(durationSeconds - shown)}` : ""}
              </Text>
              <IconButton
                icon="episodes"
                label={t.player.episodesBtn}
                onPress={() => setPanelOpen(true)}
              />
              <IconButton
                icon="next"
                label={t.player.nextAria}
                disabled={upNext === null}
                onPress={onNext}
              />
            </GlassSurface>
          </View>
        </View>
      ) : null}

      {scrub !== null && track !== null && hasDuration ? (
        <ScrubPreview
          seconds={scrub}
          storyboard={storyboard}
          // Over the knob, kept over the rail's span.
          centreX={barLeft + track.x + (scrub / durationSeconds) * track.width}
          minX={barLeft + track.x - 8}
          maxX={barLeft + track.x + track.width + 8}
          bottom={insets.bottom + BAR_BOTTOM + BAR_H + 6}
        />
      ) : null}

      {introOn ? (
        <View style={[styles.skipWrap, { right: insets.right + SIDE, bottom: insets.bottom + ABOVE_BAR }]}>
          <Pressable
            onPress={() => {
              onSeek(clampSeek(intro.end));
              poke();
            }}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}
          >
            <GlassSurface interactive style={styles.skip}>
              <Text style={styles.skipText} maxFontSizeMultiplier={TEXT_CAP}>
                {t.player.skipIntro}
              </Text>
              <Icon name="chevronRight" size={13} color={colors.ink} />
            </GlassSurface>
          </Pressable>
        </View>
      ) : null}

      {endCard && upNext ? (
        <EndCard
          upNext={upNext}
          count={autoplay ? count : null}
          onWatch={onNext}
          onCancel={() => {
            onDismissEnd();
            poke();
          }}
          style={{ right: insets.right + SIDE, bottom: insets.bottom + BAR_BOTTOM }}
        />
      ) : null}

      {panelOpen ? (
        <EpisodesPanel
          episodes={episodes}
          seasonNumber={seasonNumber}
          onSelect={(index) => {
            setPanelOpen(false);
            onSelectEpisode(index);
          }}
          onClose={() => {
            setPanelOpen(false);
            poke();
          }}
          style={{
            top: insets.top + TOP,
            bottom: insets.bottom + BAR_BOTTOM,
            right: insets.right + SIDE,
          }}
        />
      ) : null}
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      // Pressable reports `disabled` to VoiceOver itself (dimmed, «dimmed»).
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, (pressed || disabled) && styles.pressed]}
    >
      <Icon name={icon} size={20} color={colors.ink} />
    </Pressable>
  );
}

// Over the knob while a drag lasts: the storyboard frame and the time, or
// the time alone when there is no storyboard (an older server, a failed
// fetch).
function ScrubPreview({
  seconds,
  storyboard,
  centreX,
  minX,
  maxX,
  bottom,
}: {
  seconds: number;
  storyboard: Storyboard | null;
  centreX: number;
  minX: number;
  maxX: number;
  bottom: number;
}) {
  const width = storyboard ? PREVIEW_W + PREVIEW_PAD * 2 : TIME_ONLY_W;
  const left = Math.min(Math.max(centreX - width / 2, minX), maxX - width);
  return (
    <View
      testID="scrub-preview"
      pointerEvents="none"
      aria-hidden
      style={[styles.previewWrap, { left, bottom, width }]}
    >
      <GlassSurface style={styles.preview}>
        {storyboard ? (
          <StoryboardFrame board={storyboard} seconds={seconds} width={PREVIEW_W} height={PREVIEW_H} />
        ) : null}
        <Text style={styles.previewTime} maxFontSizeMultiplier={TEXT_CAP}>
          {formatTime(seconds)}
        </Text>
      </GlassSurface>
    </View>
  );
}

// The next episode, over the bar's corner, for the last END_CARD_SECONDS:
// with autoplay on, the gold button carries a ring and the count to the
// advance (the advance itself is the feed's, at `ended`); off, the card waits.
function EndCard({
  upNext,
  count,
  onWatch,
  onCancel,
  style,
}: {
  upNext: UpNext;
  // Seconds to the advance — null when autoplay is off.
  count: number | null;
  onWatch: () => void;
  onCancel: () => void;
  style: { right: number; bottom: number };
}) {
  const t = useT();
  const minutes =
    upNext.durationSeconds !== null
      ? t.episodesOverlay.minutes(Math.max(1, Math.round(upNext.durationSeconds / 60)))
      : null;
  return (
    <View testID="end-card" style={[styles.endWrap, style]}>
      <GlassSurface style={styles.endCard}>
        <View style={styles.endRow}>
          <Artwork
            uri={upNext.thumbnailUrl}
            toneKey={upNext.toneKey}
            style={styles.endThumb}
            displayWidth={END_THUMB_W}
          />
          <View style={styles.endText}>
            <Text style={styles.endKicker} maxFontSizeMultiplier={TEXT_CAP}>
              {t.upNextOverlay.label}
            </Text>
            <Text style={styles.endTitle} numberOfLines={1} maxFontSizeMultiplier={TEXT_CAP}>
              {`${t.home.epShort(upNext.number)} · ${upNext.title}`}
            </Text>
            {minutes ? (
              <Text style={styles.endMeta} maxFontSizeMultiplier={TEXT_CAP}>
                {minutes}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.endButtons}>
          <Pressable
            onPress={onWatch}
            accessibilityRole="button"
            style={({ pressed }) => [styles.endGoHit, pressed && styles.pressed]}
          >
            <GoldGlass interactive style={styles.endGo}>
              {count !== null ? (
                <CountdownRing remaining={Math.min(1, count / END_CARD_SECONDS)} />
              ) : null}
              <Text style={styles.endGoText} numberOfLines={1} maxFontSizeMultiplier={TEXT_CAP}>
                {count !== null ? `${t.upNextOverlay.watchNow} · ${count}` : t.upNextOverlay.watchNow}
              </Text>
            </GoldGlass>
          </Pressable>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}
          >
            <GlassSurface interactive style={styles.endCancel}>
              <Text style={styles.endCancelText} maxFontSizeMultiplier={TEXT_CAP}>
                {t.upNextOverlay.cancel}
              </Text>
            </GlassSurface>
          </Pressable>
        </View>
      </GlassSurface>
    </View>
  );
}

// The countdown ring, drawn without an SVG dependency: a faint full track
// and the remaining arc, clockwise from twelve o'clock, out of two half
// rings each clipped to its own half of the circle.
function CountdownRing({ remaining }: { remaining: number }) {
  const p = Math.min(1, Math.max(0, remaining));
  // A ring with only its top and right borders coloured is a half ring;
  // turned 45° it covers exactly the right half. Each half rotates it on
  // from there by its share of the remaining arc.
  const right = 45 - 180 + Math.min(p, 0.5) * 360;
  const left = 45 + Math.max(0, p - 0.5) * 360;
  return (
    <View testID="countdown-ring" style={styles.ring} aria-hidden>
      <View style={[styles.ringCircle, styles.ringTrack]} />
      <HalfClip side="right">
        <View style={[styles.ringCircle, styles.ringArc, { transform: [{ rotate: `${right}deg` }] }]} />
      </HalfClip>
      <HalfClip side="left">
        <View style={[styles.ringCircle, styles.ringArc, { transform: [{ rotate: `${left}deg` }] }]} />
      </HalfClip>
    </View>
  );
}

function HalfClip({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  return (
    <View style={[styles.half, side === "right" ? styles.halfRight : styles.halfLeft]}>
      <View style={side === "right" ? styles.halfInnerRight : styles.halfInnerLeft}>{children}</View>
    </View>
  );
}

// Whether VoiceOver / TalkBack is running, live.
function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled().then(
      (value) => {
        if (alive) setEnabled(value);
      },
      () => {},
    );
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => {
      alive = false;
      subscription?.remove();
    };
  }, []);
  return enabled;
}

// Capsules have a fixed height; past this Larger Text would clip them.
const TEXT_CAP = 1.3;
const END_THUMB_W = 112;
const RING = 22;
const RING_W = 2.2;

const styles = StyleSheet.create({
  zones: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row" },
  zoneSide: { flex: 33 },
  zoneCentre: { flex: 34 },
  centre: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },

  markZone: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "33%",
    alignItems: "center",
    justifyContent: "center",
  },
  markLeft: { left: 0 },
  markRight: { right: 0 },
  mark: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  markText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink },

  bufferDisc: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  playDisc: {
    width: 76,
    height: 76,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  // The play triangle's optical centre sits right of its box's.
  playNudge: { marginLeft: 4 },

  topLeft: { position: "absolute", maxWidth: 420 },
  titleCapsule: {
    height: CAPSULE_H,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 5,
    paddingRight: 20,
  },
  backDisc: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: { color: colors.ink, fontSize: 28, lineHeight: 30, marginTop: -2 },
  titles: { flexShrink: 1, minWidth: 0 },
  showTitle: { ...display, color: colors.ink, fontSize: 13.5, lineHeight: 16, letterSpacing: 0.54 },
  episodeLine: {
    fontFamily: fonts.bodySemi,
    color: colors.inkMuted,
    fontSize: 11,
    marginTop: 2,
  },

  topRight: { position: "absolute" },
  pipCapsule: {
    height: CAPSULE_H,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 3,
  },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },

  barWrap: { position: "absolute" },
  bar: {
    height: BAR_H,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
  },
  pill: {
    height: 48,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingLeft: 14,
    paddingRight: 18,
  },
  pillLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.goldDeep },
  time: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink,
    paddingHorizontal: 6,
    fontVariant: ["tabular-nums"],
  },
  timeLeft: { color: colors.inkDim },

  previewWrap: { position: "absolute" },
  preview: {
    borderRadius: radius.preview,
    padding: PREVIEW_PAD,
    paddingBottom: 5,
    alignItems: "center",
  },
  previewTime: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink, marginTop: 5 },

  skipWrap: { position: "absolute" },
  skip: {
    height: 44,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
  },
  skipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink },

  endWrap: { position: "absolute", width: 318 },
  endCard: { borderRadius: radius.float, padding: 10, gap: 10 },
  endRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  endThumb: { width: END_THUMB_W, height: 63, borderRadius: radius.poster },
  endText: { flex: 1, minWidth: 0 },
  endKicker: { ...display, color: colors.gold, fontSize: 10.5, letterSpacing: 2.1 },
  endTitle: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink, marginTop: 3 },
  endMeta: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim, marginTop: 2 },
  endButtons: { flexDirection: "row", gap: 8 },
  endGoHit: { flex: 1 },
  endGo: {
    height: 44,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  endGoText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.goldDeep },
  endCancel: {
    height: 44,
    borderRadius: radius.pill,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  endCancelText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink },

  ring: { width: RING, height: RING },
  ringCircle: {
    position: "absolute",
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: RING_W,
  },
  ringTrack: { borderColor: colors.track },
  ringArc: {
    borderColor: "transparent",
    borderTopColor: colors.goldDeep,
    borderRightColor: colors.goldDeep,
  },
  half: { position: "absolute", top: 0, width: RING / 2, height: RING, overflow: "hidden" },
  halfRight: { left: RING / 2 },
  halfLeft: { left: 0 },
  halfInnerRight: { position: "absolute", left: -RING / 2, width: RING, height: RING },
  halfInnerLeft: { position: "absolute", left: 0, width: RING, height: RING },
});
