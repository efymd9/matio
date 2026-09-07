import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type ViewToken,
} from "react-native";
import Video, {
  type OnLoadData,
  type OnProgressData,
  type VideoRef,
} from "react-native-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError, muxStreamUrl } from "@/api/client";
import { useConfig } from "@/api/config-context";
import { SignupWall } from "@/components/signup-wall";
import { Artwork, ErrorState, Loading } from "@/components/ui";
import { VerticalChrome } from "@/components/vertical-chrome";
import { useT } from "@/i18n/locale";
import {
  isEpisodeLockedForApp,
  type EpisodeSummary,
  type PlaybackMode,
  type PlaybackTokenResponse,
  type ShowDetail,
} from "@/shared/api-types";
import { colors, display, radius, SCREEN_PAD, space } from "@/theme";
import { useProgressSaver } from "./use-progress-saver";
import { useSegmentTracker } from "./use-segment-tracker";

// The episode feed: ONE engine for both orientations, with a pooled player.
//
// Every episode of the show is a full-screen page in a FlatList. A page
// mounts a <Video> only while it is the CURRENT page or its immediate
// neighbour — at most three players alive for a vertical show (previous /
// current / next), two for a horizontal one (current / next); everything
// further away is a poster. That is the "pool of 2–3 instances" the plan
// asks for (docs/mobile-app-plan.md §6.3), expressed as proximity rather
// than as a hand-rolled recycler: the neighbour's player is created paused
// and muted, so it buffers its opening seconds in advance, and when it
// becomes current it starts on an already-warm player — the auto-advance
// has no black frame and no token round-trip, which is what the web gets
// from its hidden preloader plus the same-element src swap.
//
//   vertical   — pagingEnabled; a swipe is the next (or previous) episode;
//                neighbours warm immediately, because a swipe can come at
//                any moment
//   horizontal — scrolling off; the next page warms only once the current
//                one is PRELOAD_LEAD_SECONDS from its end (the web's lead),
//                and `ended` jumps to it without animation
//
// The signup gate is the same one the show page draws its locks from
// (isEpisodeLockedForApp): a locked episode's page IS the sign-up wall, so
// an auto-advance or a swipe into it lands on the ask, never on a stalled
// player — and the token route still enforces the gate underneath.

// How long before the current episode ends the next one's token is fetched
// and its player mounted (horizontal). Same lead as the web player.
export const PRELOAD_LEAD_SECONDS = 45;

// Tokens refresh this long before they expire — Mux validates `exp` per
// segment request, so refreshing exactly at expiry races late segment
// fetches. Failed refreshes retry 1s/2s/4s before the unavailable state;
// the old token keeps playing meanwhile.
const REFRESH_LEAD_MS = 60_000;
const REFRESH_BACKOFF_MS = [0, 1_000, 2_000, 4_000];

// A resume target inside the last seconds is a finished episode: start over
// rather than land on the credits.
const RESUME_TAIL_SECONDS = 10;

type Playback = {
  playbackId: string;
  token: string;
  expiresAt: number;
  mode: PlaybackMode;
};

function toPlayback(res: PlaybackTokenResponse): Playback {
  return {
    playbackId: res.playbackId,
    token: res.token,
    expiresAt: Date.now() + res.expiresIn * 1000,
    mode: res.mode,
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function EpisodeFeed({
  show,
  initialIndex,
  resumeSeconds,
  signedIn,
  onBack,
  onSignIn,
}: {
  show: ShowDetail;
  initialIndex: number;
  // Applies to the initial episode only.
  resumeSeconds: number;
  signedIn: boolean;
  onBack: () => void;
  onSignIn: () => void;
}) {
  const { height } = useWindowDimensions();
  const config = useConfig();
  const vertical = show.orientation === "vertical";
  const episodes = show.episodes;
  const listRef = useRef<FlatList<EpisodeSummary>>(null);

  const [current, setCurrent] = useState(initialIndex);
  // The furthest page allowed to fetch a token and mount its player.
  const [armedIndex, setArmedIndex] = useState(vertical ? initialIndex + 1 : initialIndex);
  const [muted, setMuted] = useState(false);
  const currentRef = useRef(current);
  currentRef.current = current;

  // Subscription state is not exposed to the app yet — only paid mode reads
  // it, and paid mode is dormant. Same stance as the show page.
  const hasSubscription = false;

  const lockedAt = useCallback(
    (index: number) =>
      isEpisodeLockedForApp({
        gate: config.signupGate,
        signedIn,
        hasSubscription,
        position: index + 1,
        access: episodes[index].access,
      }),
    [config.signupGate, signedIn, episodes],
  );

  const goTo = useCallback(
    (index: number, animated: boolean) => {
      if (index < 0 || index >= episodes.length) return;
      setCurrent(index);
      setArmedIndex((a) => Math.max(a, vertical ? index + 1 : index));
      listRef.current?.scrollToIndex({ index, animated });
    },
    [episodes.length, vertical],
  );

  // `ended` on the current page: advance. Returns whether it did, so the
  // last episode's page can settle into its paused end state instead.
  const onEnded = useCallback(
    (index: number): boolean => {
      if (index !== currentRef.current) return false;
      if (index + 1 >= episodes.length) return false;
      goTo(index + 1, vertical);
      return true;
    },
    [episodes.length, goTo, vertical],
  );

  const onNearEnd = useCallback((index: number) => {
    setArmedIndex((a) => Math.max(a, index + 1));
  }, []);

  // FlatList requires this pair to be referentially stable for the list's
  // lifetime; `vertical` is fixed per show, so capturing it here is safe.
  const viewabilityPairs = useRef([
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 60 },
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[] }) => {
        const index = viewableItems[0]?.index;
        if (index === null || index === undefined) return;
        setCurrent(index);
        setArmedIndex((a) => Math.max(a, vertical ? index + 1 : index));
      },
    },
  ]).current;

  const getItemLayout = useCallback(
    (_: ArrayLike<EpisodeSummary> | null | undefined, index: number) => ({
      length: height,
      offset: height * index,
      index,
    }),
    [height],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<EpisodeSummary>) => {
      const locked = lockedAt(index);
      // The pool rule: players live on the current page and its neighbours
      // only. A horizontal show never returns to a previous page, so it
      // keeps just current + next.
      const inPool = vertical
        ? Math.abs(index - current) <= 1
        : index >= current && index <= current + 1;

      let content;
      if (locked) {
        content = <SignupWall onSignIn={onSignIn} onBack={onBack} />;
      } else if (!inPool) {
        content = <Placeholder show={show} episode={item} />;
      } else {
        content = (
          <FeedPage
            show={show}
            episode={item}
            index={index}
            isCurrent={index === current}
            armed={index <= armedIndex}
            vertical={vertical}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            signedIn={signedIn}
            resumeSeconds={index === initialIndex ? resumeSeconds : 0}
            onEnded={onEnded}
            onNearEnd={onNearEnd}
            onBack={onBack}
            onSignIn={onSignIn}
          />
        );
      }
      return <View style={{ height }}>{content}</View>;
    },
    [
      armedIndex,
      current,
      height,
      initialIndex,
      lockedAt,
      muted,
      onBack,
      onEnded,
      onNearEnd,
      onSignIn,
      resumeSeconds,
      show,
      signedIn,
      vertical,
    ],
  );

  return (
    <FlatList
      ref={listRef}
      data={episodes}
      keyExtractor={(ep) => ep.id}
      renderItem={renderItem}
      extraData={[current, armedIndex, muted, signedIn]}
      style={styles.list}
      pagingEnabled={vertical}
      scrollEnabled={vertical}
      showsVerticalScrollIndicator={false}
      decelerationRate="fast"
      initialScrollIndex={initialIndex}
      getItemLayout={getItemLayout}
      // Render only the neighbouring pages; the pool rule above bounds the
      // players tighter still.
      windowSize={3}
      initialNumToRender={1}
      maxToRenderPerBatch={2}
      viewabilityConfigCallbackPairs={viewabilityPairs}
    />
  );
}

// A page outside the pool: artwork, nothing that costs a decoder.
function Placeholder({ show, episode }: { show: ShowDetail; episode: EpisodeSummary }) {
  return (
    <Artwork
      uri={episode.thumbnailUrl ?? show.posterImageUrl}
      toneKey={`${show.slug}-${episode.id}`}
      style={StyleSheet.absoluteFill}
    />
  );
}

// One page of the feed with a live player. Keyed on the episode id by the
// list, so every hook below belongs to exactly one episode for its whole
// life — nothing carries over on advance.
function FeedPage({
  show,
  episode,
  index,
  isCurrent,
  armed,
  vertical,
  muted,
  onToggleMute,
  signedIn,
  resumeSeconds,
  onEnded,
  onNearEnd,
  onBack,
  onSignIn,
}: {
  show: ShowDetail;
  episode: EpisodeSummary;
  index: number;
  isCurrent: boolean;
  armed: boolean;
  vertical: boolean;
  muted: boolean;
  onToggleMute: () => void;
  signedIn: boolean;
  resumeSeconds: number;
  onEnded: (index: number) => boolean;
  onNearEnd: (index: number) => void;
  onBack: () => void;
  onSignIn: () => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const config = useConfig();
  const videoRef = useRef<VideoRef>(null);

  const [playback, setPlayback] = useState<Playback | null>(null);
  const [tokenError, setTokenError] = useState<ApiError | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [fetchNonce, setFetchNonce] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  // Read by the vertical chrome only; the native transport draws its own.
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const endedRef = useRef(false);
  const nearEndFiredRef = useRef(false);
  const initialSeekDoneRef = useRef(false);
  // Playhead to restore after a token refresh reloads the source.
  const resumeAfterRefreshRef = useRef<number | null>(null);

  // Anonymous flushes are refused outright in paid mode (the preview cohort
  // stays off the retention curve), so don't even queue them there.
  const trackingEnabled = isCurrent && (signedIn || config.signupGate.mode !== "tiers");
  const saver = useProgressSaver(episode.id, signedIn && isCurrent);
  const tracker = useSegmentTracker(episode.id, trackingEnabled);

  // Token fetch, once armed. The result is kept for the page's lifetime;
  // a neighbour fetched early is what makes the swipe or the advance instant.
  useEffect(() => {
    if (!armed) return;
    let cancelled = false;
    api
      .playbackToken(episode.id)
      .then((res) => {
        if (!cancelled) setPlayback(toPlayback(res));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTokenError(
          err instanceof ApiError ? err : new ApiError("server_error", "Something went wrong.", 0),
        );
      });
    return () => {
      cancelled = true;
    };
    // fetchNonce is the retry trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, episode.id, fetchNonce]);

  // Token lifecycle while this page is current: refresh REFRESH_LEAD_MS
  // before expiry (1s/2s/4s backoff on network/5xx, 4xx is terminal); a
  // legacy 60s preview token (paid mode) is not refreshed — its expiry IS
  // the paywall, as on the web.
  useEffect(() => {
    if (!isCurrent || !playback) return;
    const remaining = playback.expiresAt - Date.now();

    if (playback.mode === "trial") {
      const endTimer = setTimeout(
        () => setTokenError(new ApiError("forbidden", "", 403, "subscribe_required")),
        Math.max(0, remaining),
      );
      return () => clearTimeout(endTimer);
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const wait of REFRESH_BACKOFF_MS) {
        if (wait > 0) await sleep(wait);
        if (cancelled) return;
        try {
          const fresh = await api.playbackToken(episode.id);
          if (cancelled) return;
          resumeAfterRefreshRef.current = positionRef.current;
          setPlayback(toPlayback(fresh));
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
            if (!cancelled) setTokenError(err);
            return;
          }
        }
      }
      if (!cancelled) setVideoFailed(true);
    }, Math.max(0, remaining - REFRESH_LEAD_MS));

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isCurrent, playback, episode.id]);

  // A stable source object: a fresh literal every render would re-send the
  // prop to native on every progress tick.
  const source = useMemo(
    () =>
      playback
        ? {
            uri: muxStreamUrl(playback.playbackId, playback.token),
            // Lock screen / Control Center / Android media notification.
            metadata: {
              title: episode.title,
              subtitle: show.title,
              artist: "Matio",
              imageUri: show.posterImageUrl ?? undefined,
            },
          }
        : null,
    [playback, episode.title, show.title, show.posterImageUrl],
  );

  const onLoad = useCallback(
    (e: OnLoadData) => {
      durationRef.current = e.duration;
      setDuration(e.duration);
      // After a token refresh the source reloads; land back where the
      // viewer was. On the very first load, honour the resume target —
      // never inside the credits.
      const afterRefresh = resumeAfterRefreshRef.current;
      resumeAfterRefreshRef.current = null;
      if (afterRefresh !== null) {
        if (afterRefresh > 0) videoRef.current?.seek(afterRefresh);
        return;
      }
      if (initialSeekDoneRef.current) return;
      initialSeekDoneRef.current = true;
      if (resumeSeconds > 0 && resumeSeconds < e.duration - RESUME_TAIL_SECONDS) {
        videoRef.current?.seek(resumeSeconds);
      }
    },
    [resumeSeconds],
  );

  const onProgress = useCallback(
    (e: OnProgressData) => {
      positionRef.current = e.currentTime;
      saver.onProgress(e.currentTime);
      tracker.onProgress(e.currentTime);
      if (vertical) setPosition(e.currentTime);
      const dur = durationRef.current;
      if (
        !nearEndFiredRef.current &&
        dur > 0 &&
        dur - e.currentTime <= PRELOAD_LEAD_SECONDS
      ) {
        nearEndFiredRef.current = true;
        onNearEnd(index);
      }
    },
    [index, onNearEnd, saver, tracker, vertical],
  );

  const onEnd = useCallback(() => {
    endedRef.current = true;
    saver.onEnded();
    tracker.onEnded();
    const advanced = onEnded(index);
    // Last episode: our own chrome shows the play glyph again; the native
    // transport handles its own end state.
    if (!advanced && vertical) setUserPaused(true);
  }, [index, onEnded, saver, tracker, vertical]);

  const togglePlay = useCallback(() => {
    if (endedRef.current) {
      // Un-ending: the player sits at the end, so a bare play would do
      // nothing. Seek home first; onProgress then clears the saver's ended
      // flag as the playhead moves back.
      endedRef.current = false;
      videoRef.current?.seek(0);
      setUserPaused(false);
      return;
    }
    setUserPaused((p) => !p);
  }, []);

  // --- end states, mirroring the web player's three distinct overlays ----
  if (tokenError) {
    const { code, reason, message } = tokenError;
    const retry = () => {
      setTokenError(null);
      setFetchNonce((n) => n + 1);
    };
    // 403 signup_required — the gate, enforced server-side. Not an error; an ask.
    if (code === "forbidden" && reason === "signup_required") {
      return <SignupWall onSignIn={onSignIn} onBack={onBack} />;
    }
    // 403 subscribe_required — paid mode only, dormant while payments are off.
    if (code === "forbidden" && reason === "subscribe_required") {
      return (
        <ErrorState
          message={t.app.watch.subscribersOnly}
          hint={t.app.watch.subscribersOnlyHint}
          onRetry={retry}
        />
      );
    }
    if (code === "rate_limited") {
      return (
        <ErrorState message={t.watch.rateLimitedKicker} hint={t.watch.rateLimitedTitle} onRetry={retry} />
      );
    }
    return <ErrorState message={t.watch.unavailableKicker} hint={message} onRetry={retry} />;
  }

  // A decode/network failure inside the video element is a different failure
  // from a token failure and must not be reported as one.
  if (videoFailed) {
    return (
      <ErrorState
        message={t.watch.unavailableKicker}
        hint={t.watch.unavailableTitle}
        onRetry={() => {
          setVideoFailed(false);
          setPlayback(null);
          setFetchNonce((n) => n + 1);
        }}
      />
    );
  }

  return (
    <View style={styles.stage}>
      <Placeholder show={show} episode={episode} />
      {source ? (
        <Video
          ref={videoRef}
          source={source}
          style={StyleSheet.absoluteFill}
          // Vertical shows fill the portrait screen; landscape ones letterbox.
          resizeMode={vertical ? "cover" : "contain"}
          controls={!vertical}
          // A neighbour is created paused and muted: it buffers, and stays
          // silent and still until it becomes the current page.
          paused={!isCurrent || userPaused}
          muted={muted || !isCurrent}
          // One sample a second is plenty for a save every ten, a flush
          // every twenty and a progress bar that moves; the default 250ms
          // would re-render the chrome 4×/s.
          progressUpdateInterval={1000}
          onLoad={onLoad}
          onProgress={onProgress}
          onSeek={tracker.onSeek}
          onEnd={onEnd}
          onError={() => setVideoFailed(true)}
          // Picture-in-picture when the viewer leaves the app, audio when
          // the screen locks, now-playing controls on the lock screen —
          // the current page only, never a warming neighbour. The native
          // config behind these (iOS `audio` background mode, the Android
          // media-playback foreground service, supportsPictureInPicture)
          // comes from the react-native-video plugin options in app.json.
          enterPictureInPictureOnLeave={isCurrent}
          playInBackground={isCurrent}
          playWhenInactive={isCurrent}
          showNotificationControls={isCurrent}
          ignoreSilentSwitch="ignore"
          // AirPlay: the native transport's route button on landscape shows;
          // Control Center for vertical ones (no in-chrome picker without a
          // native module — registry).
          allowsExternalPlayback
          preventsDisplaySleepDuringVideoPlayback
        />
      ) : (
        <Loading />
      )}

      {vertical ? (
        <VerticalChrome
          showTitle={show.title}
          episodeTitle={episode.title}
          episodeNumber={episode.number}
          positionSeconds={position}
          durationSeconds={duration}
          paused={!isCurrent || userPaused}
          muted={muted}
          onTogglePlay={togglePlay}
          onToggleMute={onToggleMute}
          onBack={onBack}
        />
      ) : (
        <>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t.player.backToShowAria}
            style={[styles.back, { top: insets.top + space(2) }]}
            hitSlop={10}
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <Text style={[styles.title, { top: insets.top + space(4) }]} numberOfLines={1}>
            {episode.title}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#000" },
  stage: { flex: 1, backgroundColor: "#000" },
  back: {
    position: "absolute",
    left: SCREEN_PAD,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: { color: colors.ink, fontSize: 28, lineHeight: 30, marginTop: -2 },
  title: {
    position: "absolute",
    left: SCREEN_PAD + 52,
    right: SCREEN_PAD,
    ...display,
    color: colors.ink,
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
