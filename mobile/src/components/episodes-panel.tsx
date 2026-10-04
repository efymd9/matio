import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { GlassSurface, GoldGlass } from "@/components/glass";
import { Icon } from "@/components/icon";
import { Artwork } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { colors, fonts, radius } from "@/theme";

// The landscape player's episodes panel (#375, board E «Стекло»): a 344pt
// glass sheet that slides in from the right — the season, a close «×», and
// the show's episodes with a still, the number and title, how much of it was
// watched, the episode in view in gold. A locked episode carries a lock and
// says why; choosing it goes to its page, which IS the answer (the sign-up
// wall, «Subscribers only» — #288 / #316), exactly as an auto-advance would.

export type PanelEpisode = {
  id: string;
  number: number;
  title: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  toneKey: string;
  locked: false | "signup_required" | "subscribe_required";
  // How much of it was watched, 0–1.
  fraction: number;
  current: boolean;
};

export const PANEL_WIDTH = 344;
const THUMB_W = 104;
const THUMB_H = 58.5;
const ROW_H = THUMB_H + 14;
const SLIDE_MS = 360;

export function EpisodesPanel({
  episodes,
  seasonNumber,
  onSelect,
  onClose,
  style,
}: {
  episodes: PanelEpisode[];
  seasonNumber: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  // Its place on screen — the safe-area insets decide it.
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  // 1 = parked off the right edge, 0 = in place. A transform, never an
  // opacity: a fading parent leaves Liquid Glass rendering wrong mid-fade.
  const slide = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: SLIDE_MS,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      // The native driver does not exist on react-native-web.
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [slide]);
  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, PANEL_WIDTH + 90] });

  const currentIndex = episodes.findIndex((ep) => ep.current);

  return (
    <Animated.View testID="episodes-panel" style={[styles.wrap, style, { transform: [{ translateX }] }]}>
      <GlassSurface style={styles.panel}>
        <View style={styles.head}>
          <Text style={styles.heading} accessibilityRole="header" maxFontSizeMultiplier={TEXT_CAP}>
            {t.episodesOverlay.title}
          </Text>
          <GlassSurface style={styles.season}>
            <Text style={styles.seasonText} maxFontSizeMultiplier={TEXT_CAP}>
              {t.episodesOverlay.season(seasonNumber)}
            </Text>
          </GlassSurface>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t.episodesOverlay.closeAria}
            hitSlop={6}
          >
            <GlassSurface style={styles.close}>
              <Icon name="close" size={14} color={colors.ink} />
            </GlassSurface>
          </Pressable>
        </View>
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          // Opens with the episode in view near the top.
          contentOffset={{ x: 0, y: Math.max(0, currentIndex - 1) * ROW_H }}
        >
          {episodes.map((ep, index) => (
            <EpisodeRow key={ep.id} episode={ep} onPress={() => onSelect(index)} />
          ))}
        </ScrollView>
      </GlassSurface>
    </Animated.View>
  );
}

function EpisodeRow({ episode, onPress }: { episode: PanelEpisode; onPress: () => void }) {
  const t = useT();
  const minutes =
    episode.durationSeconds !== null
      ? t.episodesOverlay.minutes(Math.max(1, Math.round(episode.durationSeconds / 60)))
      : "";
  // No purchase words in the app (3.1.1): «Subscribers only», never «Subscribe».
  const meta =
    episode.locked === "signup_required"
      ? t.episodesOverlay.lockedSignup
      : episode.locked === "subscribe_required"
        ? t.app.watch.subscribersOnly
        : minutes;
  const heading = `${episode.number}. ${episode.title}`;
  const label = [
    heading,
    episode.locked ? `${t.episodesOverlay.lockedAria}, ${meta}` : minutes,
    episode.current ? t.episodesOverlay.nowPlaying : null,
  ]
    .filter(Boolean)
    .join(", ");
  const watched = Math.min(1, Math.max(0, episode.fraction));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-selected={episode.current}
      style={({ pressed }) => [
        styles.row,
        episode.current && styles.rowCurrent,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.thumbBox}>
        <Artwork
          uri={episode.thumbnailUrl}
          toneKey={episode.toneKey}
          style={styles.thumb}
          displayWidth={THUMB_W}
        />
        {watched > 0 ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${watched * 100}%` }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={TEXT_CAP}>
          {heading}
        </Text>
        <View style={styles.metaRow}>
          {episode.locked ? <Icon name="lock" size={11} color={colors.inkDim} /> : null}
          <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={TEXT_CAP}>
            {meta}
          </Text>
        </View>
        {episode.current ? (
          <GoldGlass style={styles.now}>
            <Text style={styles.nowText} maxFontSizeMultiplier={TEXT_CAP}>
              {t.episodesOverlay.nowPlaying}
            </Text>
          </GoldGlass>
        ) : null}
      </View>
    </Pressable>
  );
}

// The panel's rows have a fixed rhythm; past this Larger Text truncates them
// to nothing.
const TEXT_CAP = 1.3;

const styles = StyleSheet.create({
  wrap: { position: "absolute", width: PANEL_WIDTH },
  panel: { flex: 1, borderRadius: radius.panel, paddingTop: 14, paddingBottom: 6 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 20,
    paddingRight: 14,
    paddingBottom: 8,
  },
  heading: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  season: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    justifyContent: "center",
  },
  seasonText: { fontFamily: fonts.bodySemi, fontSize: 11.5, color: colors.ink },
  close: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: radius.row,
  },
  rowCurrent: { backgroundColor: colors.goldWash },
  thumbBox: { width: THUMB_W, height: THUMB_H, borderRadius: radius.thumb, overflow: "hidden" },
  thumb: { width: THUMB_W, height: THUMB_H },
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: colors.scrimTrack,
  },
  progressFill: { height: "100%", backgroundColor: colors.gold },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  rowMeta: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.inkDim, flexShrink: 1 },
  now: {
    alignSelf: "flex-start",
    marginTop: 5,
    height: 20,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    justifyContent: "center",
  },
  nowText: { fontFamily: fonts.bodySemi, fontSize: 10, color: colors.goldDeep },
});
