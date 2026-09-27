import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useRef } from "react";
import { api, settleOrNull } from "@/api/client";
import { errorHint } from "@/api/error-hint";
import { useAsync } from "@/api/use-async";
import { useOptionalAuth } from "@/auth/clerk";
import { ErrorState, Loading } from "@/components/ui";
import { useT } from "@/i18n/locale";
import { goBackOrHome } from "@/navigation";
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
  // viewer's position for THIS episode is looked up from /v1/progress.
  resume?: string;
};

function parseSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

// How long the player waits for the resume lookup before opening at 0:00.
// Resume is best-effort: a slow read (a Neon cold start) costs only the
// resume, never the screen (#303 item 3).
const RESUME_LOOKUP_TIMEOUT_MS = 2_500;

// The position to open at. An explicit `resume` param (the rail's tap) wins;
// otherwise a signed-in viewer's own row for this very episode is read —
// every partly watched episode resumes, not only the one per show the
// continue rail carries (#303 item 2). In parallel with the show, bounded,
// and a failed lookup is 0. The feed never seeks inside the credits
// (RESUME_TAIL_SECONDS), so a finished episode's end reopens at the start.
async function resolveResume(
  episodeId: string,
  explicit: number | null,
  signedIn: boolean,
): Promise<number> {
  if (explicit !== null) return explicit;
  if (!signedIn) return 0;
  const progress = await settleOrNull(api.episodeProgress(episodeId), RESUME_LOOKUP_TIMEOUT_MS);
  return progress?.positionSeconds ?? 0;
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

  const onBack = useCallback(() => goBackOrHome(router), [router]);
  const onSignIn = useCallback(() => router.push("/sign-in"), [router]);

  // Before the early returns: hooks — and the lock must also be RELEASED
  // when this screen unmounts from an error state after having rotated.
  const orientation = state.status === "ready" ? state.data.show.orientation : null;
  const focus = useOrientationLock(orientation);
  const settled = useOrientationSettled(orientation, focus);

  // The feed's current page and its playhead, remembered across its
  // remounts: the feed is unmounted while another screen covers this one
  // (sign-in from the wall — see useOrientationSettled) and must come back
  // on the page the viewer left, where they left it — not on the deep-linked
  // one, and not at 0:00 (#302 item 3). Keyed on the episode so a stale page
  // can never survive a change of route params.
  const pageRef = useRef<{ episodeId: string; index: number; positionSeconds: number } | null>(
    null,
  );
  const onCurrentChange = useCallback(
    (index: number, positionSeconds: number) => {
      pageRef.current = { episodeId, index, positionSeconds };
    },
    [episodeId],
  );

  if (state.status === "loading") return <Loading />;

  // Errors carry «Back»: the player mounts no «‹» until the feed is up.
  if (state.status === "error") {
    const missing = state.error.code === "not_found";
    return (
      <ErrorState
        message={missing ? t.showDetail.notFound : t.app.common.showLoadFailed}
        hint={missing ? undefined : errorHint(t, state.error)}
        onRetry={missing ? undefined : state.retry}
        onBack={onBack}
      />
    );
  }

  const { show, resumeSeconds } = state.data;
  const index = show.episodes.findIndex((ep) => ep.id === episodeId);
  // The episode left the ready set since the link was made (unpublished,
  // reprocessing) — the same answer the token route would give.
  if (index < 0) {
    return (
      <ErrorState
        message={t.watch.unavailableKicker}
        hint={t.watch.unavailableTitle}
        onBack={onBack}
      />
    );
  }

  // Landscape is full-bleed: nothing over the picture, from the moment the
  // show is known — while THIS screen is focused. The RN status-bar prop
  // stack is last-mounted-wins, so the element must go when a screen is
  // pushed over the player (sign-in, in portrait, wants its bar back) and
  // on unmount; both restore the root's <StatusBar style="light" />. A
  // vertical show keeps the bar — its chrome sits under insets.top.
  const statusBar =
    show.orientation === "horizontal" && focus !== null ? <StatusBar hidden /> : null;

  // The feed lays its pages out by the window it mounts with: hold it until
  // the lock has turned the screen, and while another screen covers this
  // one (see useOrientationSettled).
  if (!settled) {
    return (
      <>
        {statusBar}
        <Loading />
      </>
    );
  }

  // Back on the page the viewer left, if the feed was up before, at the
  // position the feed last reported for it (it reports where an unplayed
  // page would start, too — so the deep link's resume survives only as long
  // as the feed itself still holds it). The feed reads both once, at mount:
  // later re-renders of this screen cannot move a live feed.
  const left = pageRef.current?.episodeId === episodeId ? pageRef.current : null;
  const startIndex = left ? left.index : index;
  const startSeconds = left ? left.positionSeconds : resumeSeconds;

  return (
    <>
      {statusBar}
      <EpisodeFeed
        show={show}
        initialIndex={startIndex}
        resumeSeconds={startSeconds}
        signedIn={isSignedIn}
        onBack={onBack}
        onSignIn={onSignIn}
        onCurrentChange={onCurrentChange}
      />
    </>
  );
}
