"use client";

import { useEffect } from "react";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Icon } from "@/components/site/icon";
import { TONE_GRADIENT } from "@/lib/design";
import { useT } from "@/lib/i18n/client";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";
import { markSignupWallShown } from "@/app/watch/actions";

// End-of-free-tier prompt on episode-gated shows. The conversion path is:
//   free episodes end → "Create a free account" → Clerk sign-up modal
//   → BACK TO /watch/<slug>?ep=<first member episode> (playback resumes)
//
// Deliberately NOT /subscribe: the reward for signing up is the next
// episode, and the subscription paywall comes later (end of member tier).
// Signed-in users never see this wall (member tier unlocks for them), but
// the signed-in branch below covers a race (signed in mid-render).
export function SignupWall({
  showSlug,
  showId,
  showTitle,
  episodeLabel,
  targetEpisodeId,
  episodeNumber,
  memberCount,
}: {
  showSlug: string;
  showId: string;
  showTitle?: string;
  episodeLabel?: string;
  // The episode playback resumes at after sign-up — the locked episode the
  // viewer tried to reach (deep link / overlay tap) or the first member
  // episode (natural end of the free tier).
  targetEpisodeId: string;
  // 1-based position of the target episode, for the funnel event.
  episodeNumber: number;
  // How many member episodes an account unlocks — drives the body copy.
  memberCount: number;
}) {
  const t = useT();

  useEffect(() => {
    // Funnel stage 3, end-of-tier path (the deep-link path is stamped by
    // the token route's 403). Server-side write-once; safe to re-fire.
    void markSignupWallShown(showId);
    return onPostHogReady(() => {
      capturePostHog("signup_wall_shown", {
        show_slug: showSlug,
        episode_number: episodeNumber,
      });
    });
  }, [showId, showSlug, episodeNumber]);

  const watchHref = `/watch/${showSlug}?ep=${encodeURIComponent(targetEpisodeId)}`;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black sm:aspect-video sm:h-auto">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: TONE_GRADIENT.a }}
      />
      <div
        className="absolute inset-0 opacity-55"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 60% 40%, rgba(255,255,255,0.18), transparent 60%), radial-gradient(circle at 20% 80%, rgba(0,0,0,0.6), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 bg-black/55" />

      {/* "Free episodes watched" chip */}
      <div className="absolute left-1/2 top-[24%] -translate-x-1/2 rounded-full bg-[#ff3d3d]/95 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white backdrop-blur-md">
        {t.signupWall.freeComplete}
      </div>

      {/* Bottom sheet — safe-area padding mirrors Paywall */}
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-[#0f0f12]/95 pt-3 backdrop-blur-2xl pl-[max(env(safe-area-inset-left),1.25rem)] pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pt-4 sm:pl-[max(env(safe-area-inset-left),2rem)] sm:pr-[max(env(safe-area-inset-right),2rem)] sm:pb-[max(env(safe-area-inset-bottom),1.75rem)]">
        <div className="mx-auto max-w-2xl text-center">
          <div
            className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20"
            aria-hidden
          />

          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#ff3d3d]">
            {t.signupWall.kicker}
          </p>
          <h2 className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-white sm:text-2xl">
            {showTitle ?? t.signupWall.headlineFallback}
            {episodeLabel ? (
              <span className="ml-2 text-white/55">· {episodeLabel}</span>
            ) : null}
          </h2>
          <p className="mt-2 text-sm font-medium text-white/65">
            {memberCount > 0
              ? t.signupWall.body(memberCount)
              : t.signupWall.bodyNoCount}
          </p>

          <div className="mt-5 flex justify-center">
            <Show when="signed-out">
              <SignUpButton
                mode="modal"
                forceRedirectUrl={watchHref}
                signInForceRedirectUrl={watchHref}
              >
                <button
                  type="button"
                  onClick={() =>
                    capturePostHog("signup_cta_clicked", {
                      auth: "signed_out",
                      wall: "signup",
                    })
                  }
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(255,61,61,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12] active:scale-[0.98]"
                >
                  <Icon name="play" size={14} color="#ffffff" />
                  <span>{t.signupWall.signUpCta}</span>
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              {/* Race only: a user who signed in in another tab. The member
                  tier is already theirs — send them straight back in. */}
              <a
                href={watchHref}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 active:scale-[0.98]"
              >
                <Icon name="play" size={14} color="#ffffff" />
                <span>{t.signupWall.signUpCta}</span>
              </a>
            </Show>
          </div>

          <Show when="signed-out">
            <p className="mt-3 text-[11px] text-white/55">
              {t.signupWall.alreadyMember}{" "}
              <SignInButton
                mode="modal"
                forceRedirectUrl={watchHref}
                signUpForceRedirectUrl={watchHref}
              >
                <button
                  type="button"
                  className="font-semibold text-white/85 underline underline-offset-2 transition-colors hover:text-white"
                >
                  {t.signupWall.signInLink}
                </button>
              </SignInButton>
            </p>
          </Show>

          <p className="mt-2 text-center text-[10px] text-white/40">
            {t.signupWall.noCardNeeded}
          </p>
        </div>
      </div>
    </div>
  );
}
