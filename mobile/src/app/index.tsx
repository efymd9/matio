import { useRouter } from "expo-router";
import { useCallback } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, API_BASE_URL } from "@/api/client";
import { useAsync } from "@/api/use-async";
import {
  Artwork,
  episodeCountLabel,
  ErrorState,
  GoldButton,
  Loading,
  MetaRow,
  Pill,
  PosterCard,
  Rail,
  Scrim,
} from "@/components/ui";
import type { ShowSummary } from "@/shared/api-types";
import { colors, display, SCREEN_PAD, space } from "@/theme";

const HERO_HEIGHT = 520;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const catalog = useAsync(useCallback(() => api.catalog(), []), []);

  const openShow = useCallback(
    (slug: string) => router.push({ pathname: "/show/[slug]", params: { slug } }),
    [router],
  );

  if (catalog.status === "loading") return <Loading />;

  if (catalog.status === "error") {
    return (
      <ErrorState
        message="Couldn't load Matio"
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
            <Pill label="EN" tone="glass" />
          </View>

          <View style={styles.heroContent}>
            <Pill label="Matio Original" />
            <Text style={styles.heroTitle}>{hero.title}</Text>
            {/* Only real fields. The 8a mock's meta row reads
                "Thriller · 6 episodes · 16+", but there is no age-rating column
                in the schema — printing a hardcoded "16+" would be inventing a
                content rating, which is exactly the kind of claim an app store
                listing gets held to. Add it here when a real field exists. */}
            <MetaRow parts={[hero.genre[0] ?? "", episodeCountLabel(hero.episodeCount)]} />
            <GoldButton
              label="Watch free"
              onPress={() => openShow(hero.slug)}
              style={{ marginTop: space(5) }}
            />
          </View>
        </View>
      ) : null}

      <View style={{ marginTop: space(9) }}>
        {justReleased.length > 0 ? (
          <Rail label="Just released">
            {justReleased.map((s) => (
              <CatalogPoster key={s.id} show={s} badge="New" onPress={openShow} />
            ))}
          </Rail>
        ) : null}

        {popular.length > 0 ? (
          <Rail label="Popular now">
            {popular.map((s) => (
              <CatalogPoster key={s.id} show={s} onPress={openShow} />
            ))}
          </Rail>
        ) : null}

        <Rail label="All shows">
          {shows.map((s) => (
            <CatalogPoster key={s.id} show={s} onPress={openShow} />
          ))}
        </Rail>
      </View>

      <Text style={styles.tagline}>Story worlds. One studio.</Text>
    </ScrollView>
  );
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
