import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, API_BASE_URL } from "@/api/client";
import { useAsync } from "@/api/use-async";
import { useOptionalAuth } from "@/auth/clerk";
import { LocaleSwitch } from "@/components/locale-switch";
import {
  Artwork,
  ContinueCard,
  ErrorState,
  GoldButton,
  Loading,
  MetaRow,
  Pill,
  PosterCard,
  Rail,
  Scrim,
} from "@/components/ui";
import { useT } from "@/i18n/locale";
import type { ContinueWatchingEntry, ShowSummary } from "@/shared/api-types";
import { colors, display, SCREEN_PAD, space } from "@/theme";
import { onProgressSaved } from "@/watch/use-progress-saver";

const HERO_HEIGHT = 520;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { isSignedIn } = useOptionalAuth();

  const catalog = useAsync(useCallback(() => api.catalog(), []), []);
  const resume = useContinueWatching(isSignedIn);

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
          title: item.episodeTitle,
          showTitle: item.show.title,
          orientation: item.show.orientation,
          episodeNumber: String(item.episodeNumber),
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

  const shows = catalog.data.shows;
  const hero = shows.find((s) => s.featured) ?? shows[0];
  const justReleased = shows.filter((s) => s.justReleased);
  const popular = shows.filter((s) => s.popularNow);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: space(12) }}
    >
      {hero ? (
        <View style={{ height: HERO_HEIGHT }}>
          <Artwork uri={hero.heroImageUrl} toneKey={hero.slug} style={StyleSheet.absoluteFill} />
          <Scrim height={HERO_HEIGHT * 0.72} from="bottom" />
          <Scrim height={insets.top + space(20)} from="top" maxOpacity={0.7} />

          <View style={[styles.header, { paddingTop: insets.top + space(2) }]}>
            <Text style={styles.wordmark}>Matio</Text>
            <LocaleSwitch />
          </View>

          <View style={styles.heroContent}>
            <Pill label={t.hero.matioOriginal} />
            <Text style={styles.heroTitle}>{hero.title}</Text>
            {/* Only real fields. The 8a mock's meta row reads
                "Thriller · 6 episodes · 16+", but there is no age-rating column
                in the schema — printing a hardcoded "16+" would be inventing a
                content rating, which is exactly the kind of claim an app store
                listing gets held to. Add it here when a real field exists. */}
            <MetaRow parts={[hero.genre[0] ?? "", t.showDetail.episodeCount(hero.episodeCount)]} />
            <GoldButton
              label={t.hero.watchFree}
              onPress={() => openShow(hero.slug)}
              style={{ marginTop: space(5) }}
            />
          </View>
        </View>
      ) : null}

      <View style={{ marginTop: space(9) }}>
        {/* Resume rail sits above the catalog, as on the web home page. */}
        {resume.length > 0 ? (
          <Rail label={t.home.continueWatching}>
            {resume.map((item) => (
              <ContinueCard key={item.show.slug} item={item} onPress={() => openResume(item)} />
            ))}
          </Rail>
        ) : null}

        {justReleased.length > 0 ? (
          <Rail label={t.home.justReleased}>
            {justReleased.map((s) => (
              <CatalogPoster key={s.id} show={s} badge={t.home.newBadge} onPress={openShow} />
            ))}
          </Rail>
        ) : null}

        {popular.length > 0 ? (
          <Rail label={t.home.popularNow}>
            {popular.map((s) => (
              <CatalogPoster key={s.id} show={s} onPress={openShow} />
            ))}
          </Rail>
        ) : null}

        <Rail label={t.app.home.allShows}>
          {shows.map((s) => (
            <CatalogPoster key={s.id} show={s} onPress={openShow} />
          ))}
        </Rail>
      </View>

      <Text style={styles.tagline}>{t.footer.tagline}</Text>
    </ScrollView>
  );
}

// The continue-watching rail's data. Signed-in only (the endpoint is 401
// otherwise, and there is nothing to resume for an anonymous viewer yet).
// Refreshed on focus when a save has landed since the last load — the player
// announces saves through onProgressSaved — so coming back from an episode
// shows the position just watched, not the one from last time. While the
// player is open (this screen unfocused) saves only mark the rail dirty:
// no network per tick for a screen nobody is looking at.
function useContinueWatching(signedIn: boolean): ContinueWatchingEntry[] {
  const [items, setItems] = useState<ContinueWatchingEntry[]>([]);
  const focused = useRef(false);
  const dirty = useRef(true);

  const load = useCallback(() => {
    dirty.current = false;
    api
      .continueWatching()
      .then((res) => setItems(res.items))
      .catch(() => {
        // Best-effort: the rail simply keeps what it had.
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (!signedIn) {
        setItems([]);
        dirty.current = true;
      } else if (dirty.current) {
        load();
      }
      return () => {
        focused.current = false;
      };
    }, [signedIn, load]),
  );

  useEffect(
    () =>
      onProgressSaved(() => {
        if (focused.current && signedIn) load();
        else dirty.current = true;
      }),
    [signedIn, load],
  );

  return items;
}

function CatalogPoster({
  show,
  badge,
  onPress,
}: {
  show: ShowSummary;
  badge?: string;
  onPress: (slug: string) => void;
}) {
  return (
    <PosterCard
      title={show.title}
      posterUrl={show.posterImageUrl}
      slug={show.slug}
      badge={badge}
      onPress={() => onPress(show.slug)}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    position: "absolute",
    left: SCREEN_PAD,
    right: SCREEN_PAD,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  // Stand-in for the gold arched wordmark PNG until the brand asset is wired.
  wordmark: {
    ...display,
    color: colors.gold,
    fontSize: 20,
    letterSpacing: 2.4,
  },
  heroContent: {
    position: "absolute",
    left: SCREEN_PAD,
    right: SCREEN_PAD,
    bottom: space(8),
    gap: space(3),
  },
  heroTitle: {
    ...display,
    color: colors.ink,
    fontSize: 46,
    // The 8a spec's 0.98–1.0 line-height is a CSS ratio, where an oversized
    // glyph simply overflows its box. React Native CLIPS text to lineHeight,
    // so Anton's ascenders lose their tops at 1.0. 1.1 is the tightest that
    // renders the face intact.
    lineHeight: 51,
  },
  tagline: {
    ...display,
    color: colors.gold,
    fontSize: 11,
    letterSpacing: 3.1,
    textAlign: "center",
    marginTop: space(4),
  },
});
