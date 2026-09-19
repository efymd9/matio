import type { ReactElement } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { GlassSurface } from "@/components/glass";
import {
  Artwork,
  durationMinutes,
  MetaRow,
  Pill,
  PosterCard,
  Rail,
  Scrim,
  SectionHeader,
} from "@/components/ui";
import { useT } from "@/i18n/locale";
import type { ContinueWatchingEntry, ShowSummary } from "@/shared/api-types";
import { genreLabel, normalizeGenreKey } from "@/shared/catalog-filters";
import type { HomeFeedItem } from "@/shared/home-feed";
import { body, colors, display, radius, SCREEN_PAD, space } from "@/theme";

// The Home feed (#248, board 3 variant «c» Feed): under the untouched cover
// carousel, one vertical run of full-width hero cards — a 16:10 still with
// a scrim, a status pill, the title, a meta row, two lines of synopsis (or a
// resume bar), and a glass Play disc — with the Popular now rail and the two
// section headings slotted between them. WHICH items appear and in what
// order is the pure lib/home-feed.ts (buildHomeFeed); this file only draws
// the items it is handed.
//
// Everything here composes existing pieces — Artwork, Scrim, Pill, MetaRow,
// SectionHeader, Rail, PosterCard from ui.tsx and GlassSurface from glass.tsx
// — by import. ui.tsx itself is deliberately untouched (#247 edits it in
// parallel).

// The board's Play disc: 48pt, the glyph 13×16.
const PLAY_SIZE = 48;
// The copy column stops short of the disc.
const COPY_RIGHT = 72;

type Handlers = {
  // The whole card → the show page.
  onOpenShow: (slug: string) => void;
  // Play on a show card → episode 1 by the Home CTA's rule (locked ⇒ sign-in).
  onPlayShow: (slug: string) => void;
  // Play on a resume card → the player at the saved position.
  onResume: (entry: ContinueWatchingEntry) => void;
};

// The screen: a FlatList whose header is the carousel block the caller
// passes as an ELEMENT (never a component type — a new type per render would
// remount the carousel and lose its position), whose rows are the feed items
// and whose footer is the tagline.
export function HomeFeed({
  items,
  header,
  footer = null,
  bottomPadding,
  playBusy = false,
  onOpenShow,
  onPlayShow,
  onResume,
}: {
  items: HomeFeedItem[];
  header: ReactElement;
  footer?: ReactElement | null;
  bottomPadding: number;
  // The Home CTA's in-flight state: a second Play tap is ignored while the
  // show loads, so the discs dim together with the caption button.
  playBusy?: boolean;
} & Handlers) {
  const { width } = useWindowDimensions();
  const cardWidth = width - 2 * SCREEN_PAD;
  const last = items[items.length - 1];

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      style={styles.list}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      ListHeaderComponent={header}
      // A rail already ends in its own bottom margin; a card does not.
      ListFooterComponent={
        footer ? (
          <View style={{ marginTop: last?.kind === "rail" ? 0 : space(8) }}>{footer}</View>
        ) : null
      }
      renderItem={({ item, index }) => (
        <View style={{ marginTop: feedGap(item, items[index - 1]) }}>
          <FeedItem
            item={item}
            width={cardWidth}
            playBusy={playBusy}
            onOpenShow={onOpenShow}
            onPlayShow={onPlayShow}
            onResume={onResume}
          />
        </View>
      )}
    />
  );
}

// Vertical rhythm between rows: a heading opens a block (space(7) above it,
// SectionHeader carries its own space(4) below), cards sit space(3.5) apart,
// a rail comes space(5) after a card and ends in Rail's own space(9). The
// first row — whatever it is — stands space(7) under the caption.
function feedGap(item: HomeFeedItem, prev: HomeFeedItem | undefined): number {
  if (item.kind === "heading" || !prev) return space(7);
  if (prev.kind === "heading" || prev.kind === "rail") return 0;
  return item.kind === "rail" ? space(5) : space(3.5);
}

function FeedItem({
  item,
  width,
  playBusy,
  onOpenShow,
  onPlayShow,
  onResume,
}: { item: HomeFeedItem; width: number; playBusy: boolean } & Handlers) {
  switch (item.kind) {
    case "heading":
      return <FeedHeading label={item.label} />;
    case "resume":
      return (
        <ResumeCard entry={item.entry} width={width} onOpenShow={onOpenShow} onResume={onResume} />
      );
    case "show":
      return (
        <ShowCard
          show={item.show}
          badge={item.badge}
          width={width}
          playBusy={playBusy}
          onOpenShow={onOpenShow}
          onPlayShow={onPlayShow}
        />
      );
    case "rail":
      return <FeedRail shows={item.shows} onOpenShow={onOpenShow} />;
  }
}

// «Up next» is the app's own string; «Just released» is the web's.
export function FeedHeading({ label }: { label: "upNext" | "justReleased" }) {
  const t = useT();
  return <SectionHeader label={label === "upNext" ? t.app.home.upNext : t.home.justReleased} />;
}

// The compact Popular now rail — the catalog rail's poster cards, as on the
// board (no badges; the hero cards around it carry the pills).
export function FeedRail({
  shows,
  onOpenShow,
}: {
  shows: ShowSummary[];
  onOpenShow: (slug: string) => void;
}) {
  const t = useT();
  return (
    <Rail label={t.home.popularNow}>
      {shows.map((show) => (
        <PosterCard
          key={show.id}
          title={show.title}
          posterUrl={show.posterImageUrl}
          slug={show.slug}
          onPress={() => onOpenShow(show.slug)}
        />
      ))}
    </Rail>
  );
}

// A catalog show: genre · episode count, two lines of synopsis, the badge
// the feed rules chose (new / vertical / none).
function ShowCard({
  show,
  badge,
  width,
  playBusy,
  onOpenShow,
  onPlayShow,
}: {
  show: ShowSummary;
  badge: "new" | "vertical" | null;
  width: number;
  playBusy: boolean;
  onOpenShow: (slug: string) => void;
  onPlayShow: (slug: string) => void;
}) {
  const t = useT();
  const pill =
    badge === "new"
      ? { label: t.home.newBadge, tone: "burgundy" as const }
      : badge === "vertical"
        ? { label: t.app.browse.vertical, tone: "glass" as const }
        : null;
  return (
    <HeroCard
      width={width}
      uri={show.heroImageUrl ?? show.posterImageUrl}
      toneKey={show.slug}
      pill={pill}
      title={show.title}
      // Only real fields, as under the carousel: genre and episode count.
      meta={[
        genreLabel(normalizeGenreKey(show.genre[0] ?? "")),
        t.showDetail.episodeCount(show.episodeCount),
      ]}
      synopsis={show.synopsis}
      playLabel={t.showDetail.play}
      playDisabled={playBusy}
      onPress={() => onOpenShow(show.slug)}
      onPlay={() => onPlayShow(show.slug)}
    />
  );
}

// Something mid-way: the gold «Resume» pill, Ep. n · title · m min, and the
// progress bar in place of the synopsis. `fraction` comes from the server,
// so the bar never disagrees with the position Play resumes at.
function ResumeCard({
  entry,
  width,
  onOpenShow,
  onResume,
}: {
  entry: ContinueWatchingEntry;
  width: number;
  onOpenShow: (slug: string) => void;
  onResume: (entry: ContinueWatchingEntry) => void;
}) {
  const t = useT();
  const minutes = durationMinutes(entry.durationSeconds);
  return (
    <HeroCard
      width={width}
      uri={entry.show.heroImageUrl ?? entry.show.posterImageUrl}
      toneKey={entry.show.slug}
      pill={{ label: t.app.home.resume, tone: "gold" }}
      title={entry.show.title}
      meta={[
        t.home.epShort(entry.episodeNumber),
        entry.episodeTitle,
        minutes !== null ? t.showDetail.minutes(minutes) : "",
      ]}
      fraction={entry.fraction}
      playLabel={t.showDetail.play}
      onPress={() => onOpenShow(entry.show.slug)}
      onPlay={() => onResume(entry)}
    />
  );
}

// The card itself: still (hero, poster as the fallback, tone under both),
// a bottom scrim over 85% of the height, the copy column bottom-left, the
// glass Play disc bottom-right. Two Pressables: the disc is the deeper
// responder, so a tap on it never also opens the show page.
export function HeroCard({
  width,
  uri,
  toneKey,
  pill,
  title,
  meta,
  synopsis = null,
  fraction = null,
  playLabel,
  playDisabled = false,
  onPress,
  onPlay,
}: {
  width: number;
  uri: string | null;
  toneKey: string;
  pill: { label: string; tone: "burgundy" | "glass" | "gold" } | null;
  title: string;
  meta: string[];
  synopsis?: string | null;
  fraction?: number | null;
  playLabel: string;
  playDisabled?: boolean;
  onPress: () => void;
  onPlay: () => void;
}) {
  // 16:10, from the width the list measured — Scrim wants pixels, not %.
  const height = Math.round((width * 10) / 16);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.card, { width, height }, pressed && { opacity: 0.9 }]}
    >
      <Artwork uri={uri} toneKey={toneKey} style={StyleSheet.absoluteFill} />
      <Scrim from="bottom" height={Math.round(height * 0.85)} />

      <View style={styles.copy}>
        {pill ? <Pill label={pill.label} tone={pill.tone} /> : null}
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <MetaRow parts={meta} />
        {synopsis ? (
          <Text style={styles.synopsis} numberOfLines={2}>
            {synopsis}
          </Text>
        ) : null}
        {fraction !== null ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={onPlay}
        disabled={playDisabled}
        accessibilityRole="button"
        accessibilityLabel={playLabel}
        hitSlop={8}
        style={({ pressed }) => [styles.play, (pressed || playDisabled) && { opacity: 0.7 }]}
      >
        <GlassSurface interactive style={styles.playSurface}>
          <View style={styles.playGlyph} />
        </GlassSurface>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.bg },
  card: {
    alignSelf: "center",
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: colors.card,
  },
  copy: {
    position: "absolute",
    left: space(4),
    right: COPY_RIGHT,
    bottom: space(3.5),
    gap: space(1.5),
  },
  title: {
    ...display,
    color: colors.ink,
    fontSize: 24,
    // RN clips to lineHeight; 1.1 is the tightest Anton survives.
    lineHeight: 26,
    letterSpacing: 0.3,
  },
  synopsis: { ...body, color: colors.inkMuted, fontSize: 12.5, lineHeight: 18 },
  // The continue tile's bar, verbatim: 3pt, black at 45% under gold.
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.scrimTrack,
    overflow: "hidden",
    marginTop: space(1),
  },
  fill: { height: "100%", backgroundColor: colors.gold },
  play: { position: "absolute", right: space(3.5), bottom: space(3.5) },
  playSurface: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  // The CTA's border-triangle, in cream and sized to the disc.
  playGlyph: {
    width: 0,
    height: 0,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 13,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: colors.ink,
    marginLeft: 4,
  },
});
