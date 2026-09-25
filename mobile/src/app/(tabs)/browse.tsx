import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCatalog } from "@/api/catalog-context";
import { errorHint } from "@/api/error-hint";
import { GlassSurface } from "@/components/glass";
import { useTabBarClearance } from "@/components/glass-tab-bar";
import { Icon } from "@/components/icon";
import { ErrorState, Loading, PosterCard } from "@/components/ui";
import { useT } from "@/i18n/locale";
import type { ShowSummary } from "@/shared/api-types";
import { filterShows, genreChips, type ChipSelection } from "@/shared/catalog-filters";
import { body, colors, display, fonts, radius, SCREEN_PAD, space } from "@/theme";

// Browse (#245): the whole catalog as a two-column poster grid, narrowed by a
// glass search field (title, case- and accent-insensitive, on the client) AND
// one chip — All, a genre, or Vertical. The rules are the pure
// lib/catalog-filters.ts; this screen only holds the two inputs.

const ALL: ChipSelection = { kind: "all" };
const VERTICAL: ChipSelection = { kind: "vertical" };
const GRID_GAP = 12;
const EMPTY: ShowSummary[] = [];

export default function BrowseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const t = useT();
  const clearance = useTabBarClearance();

  const catalog = useCatalog();
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<ChipSelection>(ALL);

  const shows = catalog.status === "ready" ? catalog.data.shows : EMPTY;
  const chips = useMemo(() => genreChips(shows), [shows]);
  const hasVertical = useMemo(() => shows.some((s) => s.orientation === "vertical"), [shows]);
  const results = useMemo(() => filterShows(shows, chip, query), [shows, chip, query]);

  const openShow = useCallback(
    (slug: string) => router.push({ pathname: "/show/[slug]", params: { slug } }),
    [router],
  );

  if (catalog.status === "loading") return <Loading />;

  if (catalog.status === "error") {
    return (
      <ErrorState
        message={t.app.common.loadFailed}
        hint={errorHint(t, catalog.error)}
        onRetry={catalog.retry}
      />
    );
  }

  const cardWidth = (width - SCREEN_PAD * 2 - GRID_GAP) / 2;

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + space(4) }}>
        <Text style={styles.heading}>{t.header.browse}</Text>

        {/* The search field is glass of the same family as the bar. */}
        <GlassSurface style={styles.search}>
          <Icon name="search" size={16} color={colors.inkDim} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t.header.search}
            placeholderTextColor={colors.inkDim}
            accessibilityLabel={t.header.search}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            // The field is a fixed 44pt pill: capped for iOS Larger Text,
            // or the query overflows it.
            maxFontSizeMultiplier={1.3}
          />
          {query ? (
            <Pressable
              onPress={() => setQuery("")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.app.browse.clearSearch}
            >
              <Text style={styles.clear}>×</Text>
            </Pressable>
          ) : null}
        </GlassSurface>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          <Chip label={t.app.browse.all} active={chip.kind === "all"} onPress={() => setChip(ALL)} />
          {chips.map((genre) => (
            <Chip
              key={genre.key}
              label={genre.label}
              active={chip.kind === "genre" && chip.key === genre.key}
              onPress={() => setChip({ kind: "genre", key: genre.key })}
            />
          ))}
          {hasVertical ? (
            <Chip
              label={t.app.browse.vertical}
              active={chip.kind === "vertical"}
              onPress={() => setChip(VERTICAL)}
              mark
            />
          ) : null}
        </ScrollView>
      </View>

      <FlatList
        data={results}
        keyExtractor={(show) => show.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={{
          paddingHorizontal: SCREEN_PAD,
          paddingTop: space(4),
          paddingBottom: clearance + space(4),
          gap: space(3.5),
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // An empty grid means one of two things: the catalog itself is empty
        // (nothing published yet) or the filter matched nothing — say which.
        ListEmptyComponent={
          <Text style={styles.empty}>
            {shows.length === 0 ? t.home.catalogBeingCurated : t.app.browse.noResults}
          </Text>
        }
        renderItem={({ item }) => (
          <PosterCard
            width={cardWidth}
            title={item.title}
            posterUrl={item.posterImageUrl}
            slug={item.slug}
            badge={item.orientation === "vertical" ? t.app.browse.vertical : undefined}
            badgeTone="glass"
            onPress={() => openShow(item.slug)}
          />
        )}
      />
    </View>
  );
}

// A filter chip: translucent cream at rest, the gold CTA fill when selected.
// `mark` is the Vertical chip's rust tick — the board's «▮» prefix.
function Chip({
  label,
  active,
  onPress,
  mark = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  mark?: boolean;
}) {
  const inner = (
    <>
      {mark ? <View style={styles.chipMark} /> : null}
      <Text style={[styles.chipText, active && { color: colors.goldDeep }]}>{label}</Text>
    </>
  );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [{ borderRadius: radius.pill }, pressed && { opacity: 0.8 }]}
    >
      {active ? (
        <LinearGradient
          colors={[colors.goldHi, colors.goldLo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.chip}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View style={[styles.chip, { backgroundColor: colors.glass }]}>{inner}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: {
    ...display,
    color: colors.ink,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: 0.4,
    paddingHorizontal: SCREEN_PAD,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    marginHorizontal: SCREEN_PAD,
    marginTop: space(3.5),
    height: 44,
    borderRadius: radius.pill,
    paddingHorizontal: space(4),
  },
  input: {
    ...body,
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    paddingVertical: 0,
  },
  clear: { color: colors.inkDim, fontSize: 20, lineHeight: 22 },
  chips: {
    paddingHorizontal: SCREEN_PAD,
    gap: space(2),
    marginTop: space(3.5),
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    paddingVertical: space(2.25),
    paddingHorizontal: space(3.5),
    borderRadius: radius.pill,
  },
  chipMark: { width: 3, height: 12, backgroundColor: colors.rust, borderRadius: 1 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.inkMuted },
  empty: {
    ...body,
    color: colors.inkDim,
    fontSize: 14,
    textAlign: "center",
    marginTop: space(10),
  },
});
