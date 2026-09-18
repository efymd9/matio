import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { api } from "@/api/client";
import { useConfig } from "@/api/config-context";
import { useOptionalAuth } from "@/auth/clerk";
import { isEpisodeLockedForApp, type ShowDetail, type SignupGate } from "@/shared/api-types";

// Subscription state is not exposed to the app (only paid mode reads it —
// /v1/config should carry it rather than the app guessing; registry). The
// show page and the feed take the same stance.
const HAS_SUBSCRIPTION = false;

// Whether a show's first episode is locked for this viewer — the ONE rule
// behind the show page's «Play · Ep. 1» and the Home carousel's «Play», so a
// tap on either lands in the same place: the player, or the sign-in screen.
export function firstEpisodeLocked(show: ShowDetail, gate: SignupGate, signedIn: boolean): boolean {
  const first = show.episodes[0];
  if (!first) return false;
  return (
    isEpisodeLockedForApp({
      gate,
      signedIn,
      hasSubscription: HAS_SUBSCRIPTION,
      position: 1,
      access: first.access,
    }) !== false
  );
}

// The Home CTA. The catalog carries no episodes, so the show is loaded on the
// tap — one request, and the button reads «please wait» meanwhile; a failed
// load (or a show with nothing ready) lands on the show page, which owns the
// error and empty states.
export function usePlayFirstEpisode(): { play: (slug: string) => void; busy: boolean } {
  const router = useRouter();
  const config = useConfig();
  const { isSignedIn } = useOptionalAuth();
  const [busy, setBusy] = useState(false);

  const play = useCallback(
    (slug: string) => {
      if (busy) return;
      setBusy(true);
      api
        .show(slug)
        .then((show) => {
          const first = show.episodes[0];
          if (!first) {
            router.push({ pathname: "/show/[slug]", params: { slug } });
          } else if (firstEpisodeLocked(show, config.signupGate, isSignedIn)) {
            router.push("/sign-in");
          } else {
            router.push({
              pathname: "/watch/[episodeId]",
              params: { episodeId: first.id, showSlug: slug },
            });
          }
        })
        .catch(() => {
          router.push({ pathname: "/show/[slug]", params: { slug } });
        })
        .finally(() => setBusy(false));
    },
    [busy, config.signupGate, isSignedIn, router],
  );

  return { play, busy };
}
