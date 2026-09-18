import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api/client";
import { useConfig } from "@/api/config-context";
import { useAsync } from "@/api/use-async";
import { useOptionalAuth } from "@/auth/clerk";
import { GlassBackButton } from "@/components/glass";
import {
  Artwork,
  durationMinutes,
  ErrorState,
  GoldButton,
  Loading,
  Pill,
  Scrim,
} from "@/components/ui";
import { useT } from "@/i18n/locale";
import type {
  EpisodeSummary,
  PlaybackDenialReason,
  ShowDetail,
} from "@/shared/api-types";
import { isEpisodeLockedForApp } from "@/shared/api-types";
import { genreLabel, normalizeGenreKey } from "@/shared/catalog-filters";
import { body, colors, display, fonts, radius, SCREEN_PAD, space } from "@/theme";
import { firstEpisodeLocked } from "@/watch/first-episode";

// The show page (#245): a screen of the ROOT stack, so the tab bar is never
// here — the whole height goes to the episode list, and the only chrome is
// the glass «‹». Hero 330 with the title and genre chips, a wide «Play ·
// Ep. 1», the synopsis (two lines under Episodes, in full under About), and
// the episode cards.
const HERO_HEIGHT = 330;

type Segment = "episodes" | "about";

export default function ShowScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const config = useConfig();
  const t = useT();
  const [segment, setSegment] = useState<Segment>("episodes");

  const { isSignedIn } = useOptionalAuth();
  const signedIn = isSignedIn;
  // Subscription state is not yet exposed to the app. It only matters in paid
  // mode; free/gate mode never consults it. When payments return in the app,
  // /v1/config should carry it rather than the app guessing (registry).
  const hasSubscription = false;

  // A locked episode routes to sign-in instead of the player: the wall is the
  // point of the gate, and bouncing off a 403 would be a wasted round trip.
  // The player loads the show itself (the feed pages every episode), so only
  // the slug rides along.
  const openEpisode = useCallback(
    (show: ShowDetail, episode: EpisodeSummary, locked: boolean) => {
      if (locked) {
        router.push("/sign-in");
        return;
      }
      router.push({
        pathname: "/watch/[episodeId]",
        params: { episodeId: episode.id, showSlug: show.slug },
      });
    },
    [router],
  );

  const show = useAsync(
    useCallback(() => api.show(slug), [slug]),
    [slug],
  );

  if (show.status === "loading") return <Loading />;

  if (show.status === "error") {
    const missing = show.error.code === "not_found";
    return (
      <ErrorState
        message={missing ? t.showDetail.notFound : t.app.common.showLoadFailed}
        hint={missing ? undefined : show.error.message}
        onRetry={missing ? undefined : show.retry}
      />
    );
  }

  const data = show.data;
  // The Play CTA targets episode 1 — including when it's locked, so the button
  // leads to the wall rather than silently doing nothing. Same rule as the
  // Home carousel's Play (watch/first-episode.ts).
  const first = data.episodes[0];
  const firstLocked = firstEpisodeLocked(data, config.signupGate, signedIn);
  const synopsis =
    data.synopsis ?? t.showDetail.synopsisFallbackFree(data.title, data.genre);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: insets.bottom + space(8) }}
    >
      <View style={{ height: HERO_HEIGHT }}>
        <Artwork uri={data.heroImageUrl} toneKey={data.slug} style={StyleSheet.absoluteFill} />
        <Scrim height={HERO_HEIGHT * 0.72} from="bottom" />
        <Scrim height={insets.top + space(16)} from="top" maxOpacity={0.7} />

        <GlassBackButton
          onPress={() => router.back()}
          accessibilityLabel={t.watch.backToShowAria}
          style={[styles.back, { top: insets.top + space(2) }]}
        />

        <View style={styles.heroContent}>
          <Pill label={t.hero.matioOriginal} />
          <Text style={styles.title}>{data.title}</Text>
          {data.genre.length > 0 ? (
            <View style={styles.genres}>
              {data.genre.map((raw) => (
                <View key={raw} style={styles.genreChip}>
                  <Text style={styles.genreText}>{genreLabel(normalizeGenreKey(raw))}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ paddingHorizontal: SCREEN_PAD, marginTop: space(4), gap: space(3) }}>
        {first ? (
          <GoldButton
            label={`${t.showDetail.play} · ${t.home.epShort(1)}`}
            onPress={() => openEpisode(data, first, firstLocked)}
            style={{ alignSelf: "stretch" }}
          />
        ) : null}
        {segment === "episodes" ? (
          <Text style={styles.synopsis} numberOfLines={2}>
            {synopsis}
          </Text>
        ) : null}
      </View>

      <View style={styles.segments}>
        {(["episodes", "about"] as const).map((key) => {
          const active = segment === key;
          return (
            <Pressable
              key={key}
              onPress={() => setSegment(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              hitSlop={6}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, active && { color: colors.gold }]}>
                {key === "episodes" ? t.showDetail.tabEpisodes : t.showDetail.tabAbout}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {segment === "about" ? (
        <View style={{ paddingHorizontal: SCREEN_PAD, marginTop: space(5) }}>
          <Text style={styles.synopsis}>{synopsis}</Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: SCREEN_PAD, marginTop: space(5), gap: space(2.5) }}>
          {data.episodes.length === 0 ? (
            <Text style={styles.emptyEpisodes}>{t.showDetail.noEpisodesYetLine}</Text>
          ) : (
            data.episodes.map((ep, i) => {
              const locked = isEpisodeLockedForApp({
                gate: config.signupGate,
                signedIn,
                hasSubscription,
                position: i + 1,
                access: ep.access,
              });
              return (
                <EpisodeRow
                  key={ep.id}
                  episode={ep}
                  position={i + 1}
                  showSlug={data.slug}
                  locked={locked}
                  onPress={() => openEpisode(data, ep, locked !== false)}
                />
              );
            })
          )}
        </View>
      )}
    </ScrollView>
  );
}

function EpisodeRow({
  episode,
  position,
  showSlug,
  locked,
  onPress,
}: {
  episode: EpisodeSummary;
  position: number;
  showSlug: string;
  locked: false | PlaybackDenialReason;
  onPress: () => void;
}) {
  const t = useT();
  const minutes = durationMinutes(episode.durationSeconds);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.episodeCard, pressed && { opacity: 0.8 }]}
    >
      <View>
        <Artwork
          uri={episode.thumbnailUrl}
          toneKey={`${showSlug}-${episode.id}`}
          style={[styles.episodeThumb, locked ? { opacity: 0.45 } : null] as never}
        />
        {locked ? (
          <View style={styles.lockOverlay}>
            <Text style={styles.lockGlyph}>&#9679;</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: space(1) }}>
        <Text style={styles.episodeTitle} numberOfLines={1}>
          {position}. {episode.title}
        </Text>
        {episode.description ? (
          <Text style={styles.episodeDescription} numberOfLines={2}>
            {episode.description}
          </Text>
        ) : null}
        <View style={styles.episodeFooter}>
          <Text style={styles.episodeDuration}>
            {minutes !== null ? t.showDetail.minutes(minutes) : ""}
          </Text>
          {locked ? (
            <Text style={styles.lockLabel}>
              {locked === "signup_required"
                ? t.episodesOverlay.lockedSignup
                : t.episodesOverlay.lockedSubscribe}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { position: "absolute", left: SCREEN_PAD },
  heroContent: {
    position: "absolute",
    left: SCREEN_PAD,
    right: SCREEN_PAD,
    bottom: space(5),
    gap: space(2.5),
  },
  title: {
    ...display,
    color: colors.ink,
    fontSize: 40,
    // RN clips to lineHeight; 1.1 is the tightest Anton survives.
    lineHeight: 44,
  },
  genres: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  genreChip: {
    backgroundColor: colors.glass,
    borderRadius: radius.pill,
    paddingVertical: space(1.5),
    paddingHorizontal: space(2.5),
  },
  genreText: { fontFamily: fonts.bodySemi, color: colors.inkMuted, fontSize: 11 },
  synopsis: {
    ...body,
    color: colors.inkMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  segments: {
    flexDirection: "row",
    gap: space(5.5),
    paddingHorizontal: SCREEN_PAD,
    marginTop: space(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  segment: { paddingVertical: space(2.5), borderBottomWidth: 2, borderBottomColor: "transparent" },
  segmentActive: { borderBottomColor: colors.gold },
  segmentText: { ...display, color: colors.inkDim, fontSize: 14, letterSpacing: 1.2 },
  emptyEpisodes: { ...body, color: colors.inkDim, fontSize: 13 },
  episodeCard: {
    flexDirection: "row",
    gap: space(3),
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space(2.5),
  },
  episodeThumb: { width: 128, height: 72, borderRadius: 10 },
  lockOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  lockGlyph: { color: colors.gold, fontSize: 16 },
  episodeFooter: { flexDirection: "row", alignItems: "center", gap: space(2) },
  lockLabel: {
    ...display,
    color: colors.gold,
    fontSize: 9,
    letterSpacing: 1,
  },
  episodeTitle: { ...display, color: colors.ink, fontSize: 13, letterSpacing: 0.3 },
  episodeDescription: { ...body, color: colors.inkDim, fontSize: 12, lineHeight: 17 },
  episodeDuration: { fontFamily: fonts.mono, color: colors.rust, fontSize: 11, marginTop: space(0.5) },
});
