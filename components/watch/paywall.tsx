"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { startGuestCheckout } from "@/app/subscribe/guest-actions";
import { Icon } from "@/components/site/icon";
import { TONE_GRADIENT } from "@/lib/design";
import { useT } from "@/lib/i18n/client";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";

// Trial-end prompt. The conversion path is:
//   trial ends → "Sign up to keep watching" → Clerk sign-up modal
//   → /subscribe (plan picker + Stripe Checkout) → /watch
//
// We deliberately don't ask the user to pick a plan here. Pushing two
// decisions ("which plan?" + "make an account") at the same in-player
// moment was decision overload; plan selection belongs to /subscribe,
// which is exactly where Clerk drops the user after signup.
//
// Signed-in non-subscribers (rare on this path — only if they signed in
// then canceled and came back) skip the signup step and go straight to
// /subscribe via the secondary branch.
export function Paywall({
  showSlug,
  resumeSeconds,
  episodeLabel,
  showTitle,
  variant = "trial",
  episodeId,
  payFirst = false,
}: {
  showSlug: string;
  resumeSeconds?: number;
  episodeLabel?: string;
  showTitle?: string;
  // "trial" — legacy 60s preview ended (default; existing call sites
  // unchanged). "tier" — episode-gated show, member tier exhausted or a
  // subscriber-only episode was requested.
  variant?: "trial" | "tier";
  // Episode to return to after checkout — carried through /subscribe into
  // the Stripe success_url so the new subscriber resumes where the wall
  // interrupted them. Without it, ?resume= seeks episode 1 of the show to
  // another episode's playhead.
  episodeId?: string;
  // PAY_FIRST_CHECKOUT flag, read server-side on the watch page. When set,
  // the signed-out primary CTA posts straight to guest Stripe Checkout
  // (account created after payment) instead of opening Clerk sign-up.
  // Signed-in non-subscribers keep the /subscribe path either way.
  payFirst?: boolean;
}) {
  const t = useT();

  useEffect(() => {
    const offPostHog = onPostHogReady(() => {
      capturePostHog("paywall_shown", {
        show_slug: showSlug,
        wall: variant === "tier" ? "subscription" : "trial_end",
      });
    });

    // Meta Lead = "reached the paywall" (2026-06-10 funnel mapping:
    // ViewContent at play start → Lead here → InitiateCheckout at the CTA →
    // Purchase from the webhook). Once per browser via the localStorage
    // flag — Lead approximates unique prospects, not impressions; the flag
    // is set only AFTER the fire so a not-yet-loaded SDK doesn't burn it.
    const leadKey = "matio:fb:lead";
    let leadDone = false;
    try {
      leadDone = !!localStorage.getItem(leadKey);
    } catch {
      // Storage blocked (private mode): fire anyway.
    }
    const offPixel = leadDone
      ? () => {}
      : onPixelReady(() => {
          trackPixel("Lead", {
            content_category: "paywall",
            content_type: "product",
            content_ids: [showSlug],
          });
          try {
            localStorage.setItem(leadKey, "1");
          } catch {
            // ignore storage write failures
          }
        });

    return () => {
      offPostHog();
      offPixel();
    };
  }, [showSlug, variant]);

  const params = new URLSearchParams({ show: showSlug });
  if (episodeId) params.set("ep", episodeId);
  if (resumeSeconds && resumeSeconds > 0) {
    params.set("resume", String(resumeSeconds));
  }
  const subscribeHref = `/subscribe?${params.toString()}`;

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
      {/* Dim atmospheric backdrop (stand-in for the paused frame) */}
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

      {/* "Preview ended" red chip */}
      <div className="absolute left-1/2 top-[24%] -translate-x-1/2 rounded-full bg-[#ff3d3d]/95 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white backdrop-blur-md">
        {variant === "tier"
          ? t.paywall.allFreeWatched
          : t.paywall.previewComplete}
      </div>

      {/* Bottom sheet. Padding honors iOS home-indicator + notch safe-area
          so the CTA never sits beneath the system gesture bar. Floors keep
          the original 1.25rem/2rem cushion on devices with no inset. */}
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-[#0f0f12]/95 pt-3 backdrop-blur-2xl pl-[max(env(safe-area-inset-left),1.25rem)] pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pt-4 sm:pl-[max(env(safe-area-inset-left),2rem)] sm:pr-[max(env(safe-area-inset-right),2rem)] sm:pb-[max(env(safe-area-inset-bottom),1.75rem)]">
        <div className="mx-auto max-w-2xl text-center">
          <div
            className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20"
            aria-hidden
          />

          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#ff3d3d]">
            {t.paywall.continueWatching}
          </p>
          <h2 className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-white sm:text-2xl">
            {showTitle ?? t.paywall.yourStory}
            {episodeLabel ? (
              <span className="ml-2 text-white/55">· {episodeLabel}</span>
            ) : null}
          </h2>
          <p className="mt-2 text-sm font-medium text-white/65">
            {payFirst
              ? t.paywall.payFirstBody
              : variant === "tier"
                ? t.paywall.subscribeBody
                : t.paywall.signUpToContinue}
          </p>

          <div className="mt-5 flex justify-center">
            <Show when="signed-out">
              {payFirst ? (
                // Pay-first: straight to guest Stripe Checkout, no Clerk
                // step. The hidden fields mirror the /subscribe form so the
                // buyer returns to this exact episode+position after paying.
                <form action={startGuestCheckout} className="contents">
                  <input type="hidden" name="show" value={showSlug} />
                  {episodeId ? (
                    <input type="hidden" name="ep" value={episodeId} />
                  ) : null}
                  {resumeSeconds && resumeSeconds > 0 ? (
                    <input
                      type="hidden"
                      name="resume"
                      value={String(resumeSeconds)}
                    />
                  ) : null}
                  <PayFirstButton />
                </form>
              ) : (
                <SignUpButton
                  mode="modal"
                  forceRedirectUrl={subscribeHref}
                  signInForceRedirectUrl={subscribeHref}
                >
                  <button
                    type="button"
                    onClick={() =>
                      capturePostHog("signup_cta_clicked", {
                        auth: "signed_out",
                      })
                    }
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(255,61,61,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12] active:scale-[0.98]"
                  >
                    <Icon name="play" size={14} color="#ffffff" />
                    <span>{t.paywall.signUpCta}</span>
                  </button>
                </SignUpButton>
              )}
            </Show>
            <Show when="signed-in">
              <Link
                href={subscribeHref}
                onClick={() =>
                  capturePostHog("signup_cta_clicked", { auth: "signed_in" })
                }
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(255,61,61,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12] active:scale-[0.98]"
              >
                <Icon name="play" size={14} color="#ffffff" />
                <span>{t.paywall.continueSubscribe}</span>
              </Link>
            </Show>
          </div>

          <Show when="signed-out">
            <p className="mt-3 text-[11px] text-white/55">
              {t.paywall.alreadyMember}{" "}
              <SignInButton
                mode="modal"
                forceRedirectUrl={subscribeHref}
                signUpForceRedirectUrl={subscribeHref}
              >
                <button
                  type="button"
                  className="font-semibold text-white/85 underline underline-offset-2 transition-colors hover:text-white"
                >
                  {t.paywall.signInLink}
                </button>
              </SignInButton>
            </p>
          </Show>

          <p className="mt-2 text-center text-[10px] text-white/40">
            {t.paywall.cancelAnytimeFromAccount}
          </p>
        </div>
      </div>
    </div>
  );
}

// Submit button for the pay-first form. Lives inside the <form> so
// useFormStatus sees its pending state (true from click until the server
// action redirects to Stripe). signup_cta_clicked keeps firing — with a
// flow marker — so the saved funnels' CTA step survives the reorder even
// though the click now starts checkout instead of sign-up; the matching
// checkout_started fires server-side in startGuestCheckout.
function PayFirstButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      aria-busy={pending}
      onClick={() =>
        capturePostHog("signup_cta_clicked", {
          auth: "signed_out",
          flow: "pay_first",
        })
      }
      className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-110 hover:shadow-[0_12px_28px_-10px_rgba(255,61,61,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d3d]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12] active:scale-[0.98] disabled:cursor-wait disabled:opacity-90"
    >
      <Icon name="play" size={14} color="#ffffff" />
      <span>
        {pending ? t.paywall.continuingToCheckout : t.paywall.payFirstCta}
      </span>
    </button>
  );
}
