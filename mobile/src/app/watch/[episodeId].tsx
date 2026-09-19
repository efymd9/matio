import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useRef } from "react";
import { api } from "@/api/client";
import { useAsync } from "@/api/use-async";
import { useOptionalAuth } from "@/auth/clerk";
import { ErrorState, Loading } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { useOrientationLock, useOrientationSettled } from "@/orientation";
import { EpisodeFeed } from "@/watch/episode-feed";

// The watch screen. Loads the show (its ordered ready episodes are what the
// feed pages, advances and gates on) and the resume position, then hands
// everything to EpisodeFeed — the one player engine for both orientations.
// Playback itself is only ever reached through /v1/playback-token, per page,
// inside the feed.
//
// Orientation (#252): a horizontal show turns the screen to landscape for as
// long as this screen is mounted (full-bleed, status bar hidden); a vertical
// show keeps portrait. The lock follows the SHOW, so it can only be taken
// once the show has loaded — the spinner is portrait, the player is not.

type Params = {
  episodeId: string;
  showSlug: string;
  // Seconds; set by the continue-watching tile. Without it a signed-in
  // viewer's position is looked up from /v1/continue.
  resume?: string;
};

function parseSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

// The position to open at. An explicit `resume` param (the rail's tap) wins;
// otherwise a signed-in viewer's own continue-watching row is consulted —
// best-effort and in parallel with the show, so a failed lookup costs
// nothing but the resume.
async function resolveResume(
  episodeId: string,
  explicit: number | null,
  signedIn: boolean,
): Promise<number> {
  if (explicit !== null) return explicit;
  if (!signedIn) return 0;
  try {
    const { items } = await api.continueWatching();
    return items.find((item) => item.episodeId === episodeId)?.positionSeconds ?? 0;
  } catch {
    return 0;
  }
}

export default function WatchScreen() {
  const { episodeId, showSlug, resume } = useLocalSearchParams<Params>();
  const router = useRouter();
  const t = useT();
  const { isSignedIn } = useOptionalAuth();
  const explicitResume = parseSeconds(resume);

  // Read at fetch time, not a dependency: Clerk may finish loading a beat
  // after mount, and re-running the fetch on that flip would rebuild the
  // feed mid-start. The feed itself re-renders with the live value.
  const signedInRef = useRef(isSignedIn);
  signedInRef.current = isSignedIn;

  const state = useAsync(
    useCallback(async () => {
      const [show, resumeSeconds] = await Promise.all([
        api.show(showSlug),
        resolveResume(episodeId, explicitResume, signedInRef.current),
      ]);
      return { show, resumeSeconds };
    }, [showSlug, episodeId, explicitResume]),
    [showSlug, episodeId, explicitResume],
  );

  const onBack = useCallback(() => router.back(), [router]);
  const onSignIn = useCallback(() => router.push("/sign-in"), [router]);

  // Before the early returns: hooks — and the lock must also be RELEASED
  // when this screen unmounts from an error state after having rotated.
  const orientation = state.status === "ready" ? state.data.show.orientation : null;
  useOrientationLock(orientation);
  const settled = useOrientationSettled(orientation);

  if (state.status === "loading") return <Loading />;

  if (state.status === "error") {
    const missing = state.error.code === "not_found";
    return (
      <ErrorState
        message={missing ? t.showDetail.notFound : t.app.common.showLoadFailed}
        hint={missing ? undefined : state.error.message}
        onRetry={missing ? undefined : state.retry}
      />
    );
  }

  const { show, resumeSeconds } = state.data;
  const index = show.episodes.findIndex((ep) => ep.id === episodeId);
  // The episode left the ready set since the link was made (unpublished,
  // reprocessing) — the same answer the token route would give.
  if (index < 0) {
    return <ErrorState message={t.watch.unavailableKicker} hint={t.watch.unavailableTitle} />;
  }

  // Landscape is full-bleed: nothing over the picture, from the moment the
  // show is known. A vertical show keeps the bar — its chrome sits under
  // insets.top. The prop stack restores the root's <StatusBar style="light" />
  // on unmount.
  const statusBar = show.orientation === "horizontal" ? <StatusBar hidden /> : null;

  // The feed lays its pages out by the window it mounts with: hold it until
  // the lock has turned the screen (see useOrientationSettled).
  if (!settled) {
    return (
      <>
        {statusBar}
        <Loading />
      </>
    );
  }

  return (
    <>
      {statusBar}
      <EpisodeFeed
        show={show}
        initialIndex={index}
        resumeSeconds={resumeSeconds}
        signedIn={isSignedIn}
        onBack={onBack}
        onSignIn={onSignIn}
      />
    </>
  );
}
