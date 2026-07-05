"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
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
  backdropThumbnailUrl,
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
  // Current episode's Mux thumbnail, passed by the player. Full-bleed
  // backdrop when present; falls back to a tone gradient otherwise.
  backdropThumbnailUrl?: string | null;
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
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-espresso sm:aspect-video sm:h-auto">
      {backdropThumbnailUrl ? (
        <Image
          src={backdropThumbnailUrl}
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
          style={{ objectPosition: "40% 50%" }}
          priority
        />
      ) : (
        <div
          className="absolute inset-0"
          aria-hidden
          style={{ backgroundImage: TONE_GRADIENT.a }}
        />
      )}
      <div
        className="duotone-strong pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          backgroundImage:
            "linear-gradient(to top, rgba(15,10,7,0.97) 30%, rgba(15,10,7,0.55) 60%, rgba(15,10,7,0.25) 100%)",
        }}
      />
      <div className="glow-floor pointer-events-none absolute inset-0" aria-hidden />

      {/* Top row */}
      <div className="relative z-10 flex items-center gap-3 pt-[max(env(safe-area-inset-top),1rem)] pl-[max(env(safe-area-inset-left),1.25rem)] pr-[max(env(safe-area-inset-right),1.25rem)]">
        <Link
          href={`/shows/${showSlug}`}
          aria-label={t.player.backToShowAria}
          className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-rust/60 bg-burgundy/45 text-cream backdrop-blur-xl"
        >
          <Icon name="back" size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          {showTitle ? (
            <p className="truncate text-xs font-bold text-cream">
              {showTitle}
            </p>
          ) : null}
          {episodeLabel ? (
            <p className="truncate text-[10px] font-semibold text-cream/55">
              {episodeLabel}
            </p>
          ) : null}
        </div>
      </div>

      {/* Bottom block */}
      <div className="relative z-10 mt-auto flex flex-col gap-3.5 pb-[max(env(safe-area-inset-bottom),1.875rem)] pl-[max(env(safe-area-inset-left),1.5rem)] pr-[max(env(safe-area-inset-right),1.5rem)]">
        <span className="self-start rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream">
          {t.signupWall.kicker}
        </span>
        <h2 className="font-display text-4xl uppercase leading-[1.02] tracking-[0.01em] text-cream">
          {t.signupWall.headline}
        </h2>
        <p className="text-[13px] leading-[1.6] text-cream/72">
          {memberCount > 0
            ? t.signupWall.body(memberCount)
            : t.signupWall.bodyNoCount}
        </p>

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
              className="inline-flex h-[54px] w-full items-center justify-center rounded-full bg-gold-cta text-[15px] font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform duration-150 ease-out active:scale-[0.98]"
            >
              {t.signupWall.signUpCta}
            </button>
          </SignUpButton>
        </Show>
        <Show when="signed-in">
          {/* Race only: a user who signed in in another tab. The member
              tier is already theirs — send them straight back in. */}
          <a
            href={watchHref}
            className="inline-flex h-[54px] w-full items-center justify-center rounded-full bg-gold-cta text-[15px] font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform duration-150 ease-out active:scale-[0.98]"
          >
            {t.signupWall.signUpCta}
          </a>
        </Show>

        <Show when="signed-out">
          <p className="flex items-center justify-center gap-1.5 text-xs text-cream/55">
            <span>{t.signupWall.alreadyMember}</span>
            <SignInButton
              mode="modal"
              forceRedirectUrl={watchHref}
              signUpForceRedirectUrl={watchHref}
            >
              <button type="button" className="font-bold text-gold">
                {t.signupWall.signInLink}
              </button>
            </SignInButton>
          </p>
        </Show>

        <p className="text-center text-[10px] font-semibold tracking-[0.04em] text-cream/40">
          {t.signupWall.noCardNeeded}
        </p>
      </div>
    </div>
  );
}
