import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api/client";
import { useConfig } from "@/api/config-context";
import { useAsync } from "@/api/use-async";
import { useOptionalAuth } from "@/auth/clerk";
import {
  Artwork,
  episodeCountLabel,
  ErrorState,
  formatDuration,
  GoldButton,
  Loading,
  MetaRow,
  Pill,
  Scrim,
} from "@/components/ui";
import type { EpisodeSummary, PlaybackDenialReason } from "@/shared/api-types";
import { isEpisodeLockedForApp } from "@/shared/api-types";
import { body, colors, display, radius, SCREEN_PAD, space } from "@/theme";

const HERO_HEIGHT = 420;

export default function ShowScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const config = useConfig();

  const { isSignedIn } = useOptionalAuth();
  const signedIn = isSignedIn;
  // Subscription state is not yet exposed to the app. It only matters in paid
  // mode, which is dormant; free/gate mode never consults it. When payments
  // return, /v1/config should carry it rather than the app guessing.
  const hasSubscription = false;

  // A locked episode routes to sign-in instead of the player: the wall is the
  // point of the gate, and bouncing off a 403 would be a wasted round trip.
  const openEpisode = useCallback(
    (episodeId: string, epTitle: string, locked: boolean) => {
      if (locked) {
        router.push("/sign-in");
        return;
      }
      router.push({
        pathname: "/watch/[episodeId]",
        params: { episodeId, title: epTitle },
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
        message={missing ? "Show not found" : "Couldn't load this show"}
        hint={missing ? undefined : show.error.message}
        onRetry={missing ? undefined : show.retry}
      />
    );
  }

  const data = show.data;
  // The Play CTA targets episode 1 — including when it's locked, so the button
  // leads to the wall rather than silently doing nothing.
  const first = data.episodes[0];
  const firstLocked = first
    ? isEpisodeLockedForApp({
        gate: config.signupGate,
        signedIn,
        hasSubscription,
        position: 1,
        access: first.access,
      })
    : false;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: space(14) }}
    >
      <View style={{ height: HERO_HEIGHT }}>
        <Artwork uri={data.heroImageUrl} toneKey={data.slug} style={StyleSheet.absoluteFill} />
        <Scrim height={HERO_HEIGHT * 0.7} from="bottom" />
        <Scrim height={insets.top + space(16)} from="top" maxOpacity={0.7} />

        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            { top: insets.top + space(2) },
            pressed && { opacity: 0.7 },
          ]}
          hitSlop={8}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>

        <View style={styles.heroContent}>
          <Pill label="Matio Original" />
          <Text style={styles.title}>{data.title}</Text>
          {/* No hardcoded age rating — see the note in app/index.tsx. */}
          <MetaRow parts={[data.genre[0] ?? "", episodeCountLabel(data.episodeCount)]} />
        </View>
      </View>

      <View style={{ paddingHorizontal: SCREEN_PAD, marginTop: space(5) }}>
        {first ? (
          <GoldButton
            label="Play"
            onPress={() => openEpisode(first.id, first.title, firstLocked !== false)}
          />
        ) : null}
        {data.synopsis ? <Text style={styles.synopsis}>{data.synopsis}</Text> : null}
      </View>

      <View style={{ paddingHorizontal: SCREEN_PAD, marginTop: space(8), gap: space(3) }}>
        <Text style={styles.episodesHeading}>Episodes</Text>
        {data.episodes.length === 0 ? (
          <Text style={styles.emptyEpisodes}>No episodes are ready yet.</Text>
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
                onPress={() => openEpisode(ep.id, ep.title, locked !== false)}
              />
            );
          })
        )}
      </View>
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
          <Text style={styles.episodeDuration}>{formatDuration(episode.durationSeconds)}</Text>
          {locked ? (
            <Text style={styles.lockLabel}>
              {locked === "signup_required" ? "Free account" : "Subscribers"}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backButton: {
    position: "absolute",
    left: SCREEN_PAD,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "rgba(143,47,28,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: {
    color: colors.ink,
    fontSize: 28,
    lineHeight: 30,
    marginTop: -2,
  },
  heroContent: {
    position: "absolute",
    left: SCREEN_PAD,
    right: SCREEN_PAD,
    bottom: space(6),
    gap: space(3),
  },
  title: {
    ...display,
    color: colors.ink,
    fontSize: 40,
    // See the note on heroTitle in app/index.tsx — RN clips to lineHeight.
    lineHeight: 44,
  },
  synopsis: {
    ...body,
    color: colors.inkMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: space(5),
  },
  episodesHeading: {
    ...display,
    color: colors.gold,
    fontSize: 16,
    letterSpacing: 1.9,
    marginBottom: space(1),
  },
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
  episodeDuration: { fontFamily: "GeistMono_400Regular", color: colors.rust, fontSize: 11, marginTop: space(0.5) },
});
