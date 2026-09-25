import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { api } from "@/api/client";
import { useConfig } from "@/api/config-context";
import { useOptionalAuth } from "@/auth/clerk";
import {
  isEpisodeLockedForApp,
  type PlaybackDenialReason,
  type ShowDetail,
  type SignupGate,
} from "@/shared/api-types";

// Paid mode is live (since 2026-09-09), but /v1 carries no subscription
// state (registry): every signed-in viewer reads as a non-subscriber, so a
// `subscriber` episode is locked with `subscribe_required` for everyone.
// The show page and the feed take the same stance.
const HAS_SUBSCRIPTION = false;

// Whether — and why — a show's first episode is locked for this viewer: the
// ONE rule behind the show page's «Play · Ep. 1» and the Home carousel's
// «Play», so a tap on either lands in the same place.
export function firstEpisodeLocked(
  show: ShowDetail,
  gate: SignupGate,
  signedIn: boolean,
): false | PlaybackDenialReason {
  const first = show.episodes[0];
  if (!first) return false;
  return isEpisodeLockedForApp({
    gate,
    signedIn,
    hasSubscription: HAS_SUBSCRIPTION,
    position: 1,
    access: first.access,
  });
}

// Where a tap on an episode goes. Only an episode that asks for an ACCOUNT
// leads to sign-in — carrying the episode, so signing in lands on it rather
// than back on the list. Everything else opens the player: a subscribers-only
// episode's page in the feed says so itself (sign-in could never unlock it).
export function episodeRoute(
  lock: false | PlaybackDenialReason,
  episodeId: string,
  showSlug: string,
) {
  const params = { episodeId, showSlug };
  return lock === "signup_required"
    ? { pathname: "/sign-in" as const, params }
    : { pathname: "/watch/[episodeId]" as const, params };
}

// The Home CTA. The catalog carries no episodes, so the show is loaded on the
// tap — one request, and the button reads «please wait» meanwhile; a failed
// load (or a show with nothing ready) lands on the show page, which owns the
// error and empty states.
//
// A slow answer must not navigate over whatever the viewer moved on to: every
// tap and every blur (another card opened, another tab) starts a new
// generation, and a response only navigates if it still belongs to the
// current one AND the screen is still focused.
export function usePlayFirstEpisode(): { play: (slug: string) => void; busy: boolean } {
  const router = useRouter();
  const navigation = useNavigation();
  const config = useConfig();
  const { isSignedIn } = useOptionalAuth();
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  useFocusEffect(
    useCallback(
      () => () => {
        generation.current += 1;
        setBusy(false);
      },
      [],
    ),
  );

  const play = useCallback(
    (slug: string) => {
      if (busy) return;
      const mine = ++generation.current;
      const stillWanted = () => generation.current === mine && navigation.isFocused();
      setBusy(true);
      api
        .show(slug)
        .then((show) => {
          if (!stillWanted()) return;
          const first = show.episodes[0];
          if (!first) {
            router.push({ pathname: "/show/[slug]", params: { slug } });
            return;
          }
          const lock = firstEpisodeLocked(show, config.signupGate, isSignedIn);
          router.push(episodeRoute(lock, first.id, slug));
        })
        .catch(() => {
          if (!stillWanted()) return;
          router.push({ pathname: "/show/[slug]", params: { slug } });
        })
        .finally(() => {
          if (generation.current === mine) setBusy(false);
        });
    },
    [busy, config.signupGate, isSignedIn, navigation, router],
  );

  return { play, busy };
}
