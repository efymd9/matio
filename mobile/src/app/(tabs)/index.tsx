import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, API_BASE_URL } from "@/api/client";
import { useAsync } from "@/api/use-async";
import { useOptionalAuth } from "@/auth/clerk";
import { useTabBarClearance } from "@/components/glass-tab-bar";
import {
  Artwork,
  ContinueCard,
  ErrorState,
  GoldButton,
  Loading,
  MetaRow,
  Pill,
  Rail,
} from "@/components/ui";
import { useT } from "@/i18n/locale";
import type { ContinueWatchingEntry, ShowSummary } from "@/shared/api-types";
import { genreLabel, normalizeGenreKey } from "@/shared/catalog-filters";
import { colors, display, SCREEN_PAD, space } from "@/theme";
import { usePlayFirstEpisode } from "@/watch/first-episode";
import { useContinueWatching } from "@/watch/use-continue-watching";

// Home (#245, board B1): the wordmark, a carousel of covers with the featured
// show in focus and its neighbours peeking in at 92% / 55%, the focused
// show's badge · meta · Play under it, and the continue-watching rail below
// (signed-in only). The rest of the catalog lives on Browse.

// The card geometry of the board — 262×392, radius 18, 14pt apart — and the
// scroll step the snap points and the neighbour animation both derive from.
const CARD_W = 262;
const CARD_H = 392;
const CARD_GAP = 14;
const STEP = CARD_W + CARD_GAP;

const EMPTY: ShowSummary[] = [];

// The featured show first, then the catalog in its own order.
function carouselOrder(shows: ShowSummary[]): ShowSummary[] {
  const featured = shows.find((s) => s.featured);
  return featured ? [featured, ...shows.filter((s) => s !== featured)] : shows;
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const t = useT();
  const { isSignedIn } = useOptionalAuth();
  const clearance = useTabBarClearance();

  const catalog = useAsync(useCallback(() => api.catalog(), []), []);
  const resume = useContinueWatching(isSignedIn);
  const { play, busy } = usePlayFirstEpisode();

  const shows = catalog.status === "ready" ? catalog.data.shows : EMPTY;
  const ordered = useMemo(() => carouselOrder(shows), [shows]);

  // Which card is in focus — the caption under the carousel reads it. The
  // scroll position itself lives on the UI thread (scrollX) and drives the
  // neighbour scale/opacity without a render per frame.
  const [focusedIndex, setFocusedIndex] = useState(0);
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });
  const settle = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setFocusedIndex(Math.max(0, Math.round(e.nativeEvent.contentOffset.x / STEP)));
  }, []);

  const openShow = useCallback(
    (slug: string) => router.push({ pathname: "/show/[slug]", params: { slug } }),
    [router],
  );

  // The tile carries everything the player needs to land mid-episode: the
  // resume position, and the show's orientation, which picks its chrome.
  const openResume = useCallback(
    (item: ContinueWatchingEntry) =>
      router.push({
        pathname: "/watch/[episodeId]",
        params: {
          episodeId: item.episodeId,
          showSlug: item.show.slug,
          resume: String(item.positionSeconds),
        },
      }),
    [router],
  );

  if (catalog.status === "loading") return <Loading />;

  if (catalog.status === "error") {
    return (
      <ErrorState
        message={t.app.common.loadFailed}
        // The overwhelmingly likely cause in development is the Next dev server
        // not running, so name the actual base URL rather than a generic
        // "check your connection".
        hint={`${catalog.error.message}\n${API_BASE_URL}`}
        onRetry={catalog.retry}
      />
    );
  }

  // Clamped, not reset: a catalog reload that shrinks the list simply moves
  // the focus to the last card — no state to synchronise.
  const focused = ordered[Math.min(focusedIndex, ordered.length - 1)];
  // Side padding that centres a card in the viewport; the snap interval is
  // one step, so every settled position is a centred card.
  const sidePad = Math.max(SCREEN_PAD, (width - CARD_W) / 2);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: clearance + space(4) }}
    >
      <View style={[styles.header, { paddingTop: insets.top + space(2) }]}>
        {/* Stand-in for the gold arched wordmark PNG until the brand asset is wired. */}
        <Text style={styles.wordmark}>Matio</Text>
      </View>

      {focused ? (
        <>
          <Animated.FlatList
            data={ordered}
            keyExtractor={(show) => show.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={STEP}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: sidePad, gap: CARD_GAP }}
            style={styles.carousel}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={settle}
            onScrollEndDrag={settle}
            getItemLayout={(_, index) => ({ length: STEP, offset: STEP * index, index })}
            renderItem={({ item, index }) => (
              <CarouselCard
                show={item}
                index={index}
                scrollX={scrollX}
                onPress={() => openShow(item.slug)}
              />
            )}
          />

          <View style={styles.caption}>
            <Pill label={focused.featured ? t.hero.premiereBadge : t.hero.matioOriginal} />
            {/* Only real fields: genre and episode count. There is no age
                rating or runtime on the catalog DTO, and printing one would
                be inventing a claim the store listing gets held to. */}
            <MetaRow
              parts={[
                genreLabel(normalizeGenreKey(focused.genre[0] ?? "")),
                t.showDetail.episodeCount(focused.episodeCount),
              ]}
            />
            <GoldButton
              label={busy ? t.app.common.pleaseWait : t.showDetail.play}
              onPress={() => play(focused.slug)}
              style={styles.cta}
            />
          </View>
        </>
      ) : (
        <Text style={styles.empty}>{t.home.catalogBeingCurated}</Text>
      )}

      {resume.length > 0 ? (
        <View style={{ marginTop: space(9) }}>
          <Rail label={t.home.continueWatching}>
            {resume.map((item) => (
              <ContinueCard key={item.show.slug} item={item} onPress={() => openResume(item)} />
            ))}
          </Rail>
        </View>
      ) : null}
    </ScrollView>
  );
}

// One cover. Its distance from the centre (in cards) drives scale and
// opacity on the UI thread — the board's .92 / .55 neighbours.
function CarouselCard({
  show,
  index,
  scrollX,
  onPress,
}: {
  show: ShowSummary;
  index: number;
  scrollX: SharedValue<number>;
  onPress: () => void;
}) {
  const animated = useAnimatedStyle(() => {
    const distance = Math.min(1, Math.abs(scrollX.value / STEP - index));
    return {
      transform: [{ scale: interpolate(distance, [0, 1], [1, 0.92]) }],
      opacity: interpolate(distance, [0, 1], [1, 0.55]),
    };
  });

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={show.title}>
      <Animated.View style={[styles.card, animated]}>
        <Artwork uri={show.posterImageUrl} toneKey={show.slug} style={styles.cardArt} />
        {/* A poster carries its own title; the tone fallback does not. */}
        {show.posterImageUrl ? null : (
          <Text style={styles.cardTitle} numberOfLines={3}>
            {show.title}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingHorizontal: SCREEN_PAD,
  },
  wordmark: {
    ...display,
    color: colors.gold,
    fontSize: 20,
    letterSpacing: 2.4,
  },
  carousel: { marginTop: space(6) },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 18,
    overflow: "hidden",
  },
  cardArt: { width: CARD_W, height: CARD_H, borderRadius: 18 },
  cardTitle: {
    ...display,
    position: "absolute",
    left: space(3),
    right: space(3),
    bottom: space(3),
    color: colors.ink,
    fontSize: 34,
    // RN clips to lineHeight; 1.1 is the tightest Anton survives.
    lineHeight: 38,
  },
  caption: {
    alignItems: "center",
    paddingHorizontal: SCREEN_PAD,
    marginTop: space(5),
    gap: space(2),
  },
  cta: { marginTop: space(2), paddingHorizontal: space(3) },
  empty: {
    ...display,
    color: colors.inkDim,
    fontSize: 16,
    textAlign: "center",
    marginTop: space(20),
    paddingHorizontal: SCREEN_PAD,
  },
});
