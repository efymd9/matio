import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
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
import { errorHint } from "@/api/error-hint";
import { GlassBackButton } from "@/components/glass";
import { SignupWall } from "@/components/signup-wall";
import { Artwork, ErrorState, Loading } from "@/components/ui";
import { VerticalChrome } from "@/components/vertical-chrome";
import { useT } from "@/i18n/locale";
import { autoplayNextEnabled, loadAutoplayNext } from "@/prefs/autoplay";
import {
  isEpisodeLockedForApp,
  type EpisodeSummary,
  type PlaybackMode,
  type PlaybackTokenResponse,
  type ShowDetail,
} from "@/shared/api-types";
import { colors, display, SCREEN_PAD, space } from "@/theme";
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
// The gate is the same one the show page draws its locks from
// (isEpisodeLockedForApp): an episode that asks for an account has the
// sign-up wall as its page, a subscribers-only one the «Subscribers only»
// state — so an auto-advance or a swipe into it lands on the answer, never on
// a stalled player — and the token route still enforces the gate underneath.

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

// A signed-in viewer answered `signup_required` asked without the session:
// api/client drops the Authorization header when Clerk's getToken() misses
// its 3s pre-flight deadline (a cold start, a slow network). It is the token
// that is late, not the viewer who is signed out — so one quiet retry this
// long after, before anything is concluded.
const SIGNED_IN_RETRY_MS = 1_000;

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
  onCurrentChange,
}: {
  show: ShowDetail;
  initialIndex: number;
  // Applies to the initial episode only.
  resumeSeconds: number;
  signedIn: boolean;
  onBack: () => void;
  onSignIn: () => void;
  // The current page, every time it changes (and once on mount) — the watch
  // screen remembers it across a remount of the feed (#252).
  onCurrentChange?: (index: number) => void;
}) {
  const { height } = useWindowDimensions();
  const config = useConfig();
  const t = useT();
  const vertical = show.orientation === "vertical";
  const episodes = show.episodes;
  const listRef = useRef<FlatList<EpisodeSummary>>(null);

  const [current, setCurrent] = useState(initialIndex);
  // The furthest page allowed to fetch a token and mount its player.
  const [armedIndex, setArmedIndex] = useState(vertical ? initialIndex + 1 : initialIndex);
  const [muted, setMuted] = useState(false);
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    onCurrentChange?.(current);
  }, [current, onCurrentChange]);

  // Subscription state is not exposed to the app yet (registry): paid mode is
  // live, and every signed-in viewer reads as a non-subscriber. Same stance
  // as the show page.
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

  // The «Play next episode automatically» setting is read synchronously at
  // `ended`; warm its cache now so the first end of this session sees the
  // stored value, not the default.
  useEffect(() => {
    void loadAutoplayNext();
  }, []);

  // `ended` on the current page: advance. Returns whether it did, so the
  // last episode's page can settle into its paused end state instead.
  const onEnded = useCallback(
    (index: number): boolean => {
      if (index !== currentRef.current) return false;
      if (index + 1 >= episodes.length) return false;
      // Settings → Playback → autoplay off: a landscape show rests on its
      // ended page (the native transport's own end state) instead of
      // rolling into the next episode. A vertical show is a feed — the
      // swipe is the viewer's choice and `ended` advances as before.
      if (!vertical && !autoplayNextEnabled()) return false;
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
        // Viewability is the SWIPE's way of changing the page. A horizontal
        // show cannot be scrolled (`scrollEnabled` off) and moves only through
        // goTo, which sets `current` itself — and during the landscape resize
        // (#252) the stale pixel offset briefly reads as the NEXT page: acting
        // on that unmounted the playing page, fetched the neighbour's token
        // and remounted the page a frame later. Seen in the simulator; hence
        // vertical only.
        if (!vertical) return;
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

  // A vertical FlatList keeps its PIXEL offset across a resize, which then
  // points inside the wrong page for any current index above 0. The watch
  // screen mounts this list only once the window has the show's shape
  // (useOrientationSettled, #252), so the landscape lock normally never
  // resizes a mounted list — this re-pin is for the cases that still can:
  // an iPad, where the lock is ignored and the viewer rotates the device
  // mid-episode, or the grace fallback. getItemLayout is exact, so no
  // measuring. (Rotating a mounted list also drops and re-creates the
  // current page — the reason the screen waits rather than relying on this.)
  const pageHeightRef = useRef(height);
  useEffect(() => {
    if (pageHeightRef.current === height) return;
    pageHeightRef.current = height;
    listRef.current?.scrollToIndex({ index: currentRef.current, animated: false });
  }, [height]);

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
      if (locked === "signup_required") {
        content = <SignupWall onSignIn={onSignIn} onBack={onBack} />;
      } else if (locked === "subscribe_required") {
        // Signing in cannot open it, so no wall and no retry: the same
        // answer the token route's 403 gets inside the page.
        content = (
          <ErrorState message={t.app.watch.subscribersOnly} hint={t.app.watch.subscribersOnlyHint} />
        );
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
      t,
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
  const [authRetried, setAuthRetried] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  // Read by the vertical chrome only; the native transport draws its own.
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const endedRef = useRef(false);
  const bufferingRef = useRef(false);
  const nearEndFiredRef = useRef(false);
  const initialSeekDoneRef = useRef(false);
  // Playhead to restore after a token refresh — or a retry — reloads the
  // source.
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

  // Every retry reloads the source from a fresh token. The old playback goes
  // (a player mounted on the stale token would take the resume below and then
  // lose it to the new source), and the playhead is remembered, so onLoad
  // lands where the viewer was rather than at 0:00 — where the next save tick
  // would overwrite the saved position with the earlier one. A page that
  // never played keeps its first-load resume instead.
  const refetch = useCallback(() => {
    if (positionRef.current > 0) resumeAfterRefreshRef.current = positionRef.current;
    setTokenError(null);
    setVideoFailed(false);
    setPlayback(null);
    setFetchNonce((n) => n + 1);
  }, []);

  // The late-session retry (SIGNED_IN_RETRY_MS): once per page.
  const staleSession =
    signedIn && tokenError?.code === "forbidden" && tokenError.reason === "signup_required";
  useEffect(() => {
    if (!staleSession || authRetried) return;
    const timer = setTimeout(() => {
      setAuthRetried(true);
      refetch();
    }, SIGNED_IN_RETRY_MS);
    return () => clearTimeout(timer);
  }, [staleSession, authRetried, refetch]);

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
    // transport handles its own end state. A page the feed advanced past is
    // left un-paused — it restarts when it is swiped back to (below).
    setUserPaused(!advanced && vertical);
  }, [index, onEnded, saver, tracker, vertical]);

  // The player pauses on its own — a lock-screen or Control Center pause, a
  // call — without the `paused` prop knowing. The current page follows the
  // player's report, so the chrome shows the truth and the first tap plays
  // rather than "pausing" what already is. A stall (Android reports it as
  // not playing), a seek and the end (onEnd owns that) are not the viewer's
  // pause and are ignored.
  const onPlaybackStateChanged = useCallback(
    (e: { isPlaying: boolean; isSeeking: boolean }) => {
      if (!isCurrent || e.isSeeking || bufferingRef.current || endedRef.current) return;
      setUserPaused(!e.isPlaying);
    },
    [isCurrent],
  );

  // AirPods out / headphones unplugged: pause, never go on out loud through
  // the speaker (iOS pauses by itself; Android only reports it).
  const onAudioBecomingNoisy = useCallback(() => {
    if (isCurrent) setUserPaused(true);
  }, [isCurrent]);

  // Swiping back to a page that already ended: start it over, as a tap on its
  // play glyph would — not a frozen last frame with no glyph on it.
  useEffect(() => {
    if (!isCurrent || !endedRef.current) return;
    endedRef.current = false;
    videoRef.current?.seek(0);
    setUserPaused(false);
  }, [isCurrent]);

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
    const { code, reason } = tokenError;
    const retry = refetch;
    // 403 signup_required — the gate, enforced server-side. Not an error; an
    // ask — for a viewer who is signed out. Signed in, the answer came from a
    // request that went out without the session: a spinner while the one
    // quiet retry runs, then an honest failure, never a wall asking an
    // account holder to sign in.
    if (code === "forbidden" && reason === "signup_required") {
      if (!signedIn) return <SignupWall onSignIn={onSignIn} onBack={onBack} />;
      if (!authRetried) return <Loading />;
      return (
        <ErrorState message={t.watch.unavailableKicker} hint={t.watch.unavailableTitle} onRetry={retry} />
      );
    }
    // 403 subscribe_required — paid mode: the episode (or the legacy 60s
    // preview) needs a subscription the app cannot sell.
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
    return (
      <ErrorState
        message={t.watch.unavailableKicker}
        hint={errorHint(t, tokenError, t.watch.unavailableTitle)}
        onRetry={retry}
      />
    );
  }

  // A decode/network failure inside the video element is a different failure
  // from a token failure and must not be reported as one.
  if (videoFailed) {
    return (
      <ErrorState message={t.watch.unavailableKicker} hint={t.watch.unavailableTitle} onRetry={refetch} />
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
          onBuffer={(e) => {
            bufferingRef.current = e.isBuffering;
          }}
          onPlaybackStateChanged={onPlaybackStateChanged}
          onAudioBecomingNoisy={onAudioBecomingNoisy}
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
          // The glyph is the viewer's own pause only: a neighbour page is
          // paused by the pool, and showing it there flashed the disc on
          // both pages of every swipe.
          paused={userPaused}
          muted={muted}
          onTogglePlay={togglePlay}
          onToggleMute={onToggleMute}
          onBack={onBack}
        />
      ) : (
        <>
          {/* The same glass «‹» as the show page — the board's one new
              piece of player chrome. In landscape (#252) the screen is
              locked with the status bar hidden, so the top inset is ~0 and
              the LEFT inset is the notch: the «‹» and the title take the
              leading safe area, top-left, clear of the native transport's
              pill on the trailing side. */}
          <GlassBackButton
            onPress={onBack}
            accessibilityLabel={t.player.backToShowAria}
            style={[styles.back, { top: insets.top + space(2), left: insets.left + SCREEN_PAD }]}
          />
          <Text
            style={[
              styles.title,
              {
                top: insets.top + space(4),
                left: insets.left + SCREEN_PAD + 52,
                right: insets.right + SCREEN_PAD,
              },
            ]}
            numberOfLines={1}
          >
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
  // Insets (top/left/right) are applied inline — they differ per orientation.
  back: { position: "absolute" },
  title: {
    position: "absolute",
    ...display,
    color: colors.ink,
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
