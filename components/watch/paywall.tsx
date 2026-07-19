"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { OpenInBrowserHint } from "@/components/watch/open-in-browser-hint";
import { TONE_GRADIENT } from "@/lib/design";
import { useT } from "@/lib/i18n/client";
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
    // No Meta event here since 2026-07-19: Lead was remapped to "finished
    // the first episode of a show" (fired by the player's ended handler,
    // still once per browser via the shared matio:fb:lead flag). Paywall
    // impressions live in PostHog only.
    return onPostHogReady(() => {
      capturePostHog("paywall_shown", {
        show_slug: showSlug,
        wall: variant === "tier" ? "subscription" : "trial_end",
      });
    });
  }, [showSlug, variant]);

  const params = new URLSearchParams({ show: showSlug });
  if (episodeId) params.set("ep", episodeId);
  if (resumeSeconds && resumeSeconds > 0) {
    params.set("resume", String(resumeSeconds));
  }
  const subscribeHref = `/subscribe?${params.toString()}`;
  // Pay-first guests go to the in-site /checkout page (embedded Stripe form),
  // which creates the guest session on mount (createCheckoutSession →
  // createGuestCheckoutSession). Same watch-flow params so they resume here.
  const checkoutHref = `/checkout?${params.toString()}`;

  const primaryCta =
    "inline-flex h-[52px] items-center justify-center rounded-full bg-gold-cta px-7 text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-[transform,filter,box-shadow] duration-150 ease-out hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-espresso-2 active:scale-[0.98]";

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-espresso sm:aspect-video sm:h-auto">
      {/* Dim atmospheric backdrop (stand-in for the paused frame) */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{ backgroundImage: TONE_GRADIENT.a }}
      />
      <div className="duotone-strong pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          backgroundImage:
            "linear-gradient(to top, rgba(15,10,7,0.97) 30%, rgba(15,10,7,0.55) 60%, rgba(15,10,7,0.25) 100%)",
        }}
      />
      <div className="glow-floor pointer-events-none absolute inset-0" aria-hidden />

      {/* "Preview ended" badge */}
      <div className="absolute left-1/2 top-[24%] -translate-x-1/2 rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream">
        {variant === "tier"
          ? t.paywall.allFreeWatched
          : t.paywall.previewComplete}
      </div>

      {/* Bottom sheet. Padding honors iOS home-indicator + notch safe-area
          so the CTA never sits beneath the system gesture bar. Floors keep
          the original 1.25rem/2rem cushion on devices with no inset. */}
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-rust/30 bg-espresso-2/95 pt-3 backdrop-blur-2xl pl-[max(env(safe-area-inset-left),1.25rem)] pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pt-4 sm:pl-[max(env(safe-area-inset-left),2rem)] sm:pr-[max(env(safe-area-inset-right),2rem)] sm:pb-[max(env(safe-area-inset-bottom),1.75rem)]">
        <div className="mx-auto max-w-2xl text-center">
          <div
            className="mx-auto mb-3 h-1 w-9 rounded-full bg-cream/20"
            aria-hidden
          />

          <span className="inline-flex rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream">
            {t.paywall.continueWatching}
          </span>
          <h2 className="mt-3 font-display text-xl uppercase leading-tight tracking-[0.01em] text-cream sm:text-2xl">
            {showTitle ?? t.paywall.yourStory}
            {episodeLabel ? (
              <span className="ml-2 text-cream/55">· {episodeLabel}</span>
            ) : null}
          </h2>
          <p className="mt-2 text-sm font-medium text-cream/72">
            {payFirst
              ? t.paywall.payFirstBody
              : variant === "tier"
                ? t.paywall.subscribeBody
                : t.paywall.signUpToContinue}
          </p>
          <p className="mt-2 text-xs font-medium text-cream/45">
            {t.paywall.benefits}
          </p>

          {/* In-app browser (FB/IG webview) escape — PROMINENT, above the CTA:
              auth + Apple/Google Pay are unreliable in webviews, so nudge the
              user into their real browser before they pay. Renders nothing
              outside a webview. Pay-first signed-out only (that's the guest
              checkout path the webview breaks). */}
          {payFirst ? (
            <Show when="signed-out">
              <OpenInBrowserHint />
            </Show>
          ) : null}

          <div className="mt-5 flex justify-center">
            <Show when="signed-out">
              {payFirst ? (
                // Pay-first: straight to the in-site /checkout page (embedded
                // Stripe form), no Clerk step. The params carry show+episode+
                // position so the buyer returns to this exact spot after paying.
                <Link
                  href={checkoutHref}
                  prefetch={false}
                  onClick={() =>
                    capturePostHog("signup_cta_clicked", {
                      auth: "signed_out",
                      flow: "pay_first",
                    })
                  }
                  className={primaryCta}
                >
                  {t.paywall.payFirstCta}
                </Link>
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
                    className={primaryCta}
                  >
                    {t.paywall.signUpCta}
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
                className={primaryCta}
              >
                {t.paywall.continueSubscribe}
              </Link>
            </Show>
          </div>

          {payFirst ? (
            <Show when="signed-out">
              <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] font-medium text-cream/45">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {t.subscribe.secureCheckout}
              </p>
            </Show>
          ) : null}

          <Show when="signed-out">
            <p className="mt-3 text-[11px] text-cream/55">
              {t.paywall.alreadyMember}{" "}
              <SignInButton
                mode="modal"
                forceRedirectUrl={subscribeHref}
                signUpForceRedirectUrl={subscribeHref}
              >
                <button
                  type="button"
                  className="font-bold text-gold underline underline-offset-2 transition-colors hover:text-gold-hi"
                >
                  {t.paywall.signInLink}
                </button>
              </SignInButton>
            </p>
          </Show>

          <p className="mt-2 text-center text-[10px] text-cream/40">
            {t.paywall.cancelAnytimeFromAccount}
          </p>
        </div>
      </div>
    </div>
  );
}
