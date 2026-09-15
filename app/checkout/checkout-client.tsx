"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import {
  checkoutSessionState,
  createCheckoutSession,
} from "@/app/checkout/actions";
import { useT } from "@/lib/i18n/client";
import { getStripeBrowser } from "@/lib/stripe-browser";

// In-site Embedded Checkout host. On mount it asks the server to create a
// Checkout Session (same guards, metadata, trial/tax/consent config as the old
// redirect flow — see app/subscribe/{actions,guest-actions}.ts) and then:
//   - embedded → mount the Stripe iframe in-page (the buyer never leaves matio)
//   - hosted   → full-navigate to Stripe (publishable key not configured)
//   - redirect → router.replace (guard bounce: already subscribed, rate-limited,
//                flag off → /subscribe → Clerk sign-up)
// After payment Stripe redirects the top frame to the session's return_url
// (/welcome for guests, the watch path for signed-in buyers), so the existing
// claim + webhook-mirror machinery is untouched.
//
// Since #217 a signed-in buyer holds at most ONE open Checkout Session: every
// newer checkout (a second /checkout tab, the paywall's wallet button) expires
// the others. This form can therefore be dead by the time its tab is looked at
// again, and Stripe's embedded iframe gives no signal for that — so on every
// return to the tab the client asks the server whether its session is still
// open and, if not, swaps the dead iframe for the retry prompt. The retry is a
// reload, i.e. a fresh session, which in turn closes the newer one elsewhere:
// the tab the buyer is looking at is the live one.
export function CheckoutClient({
  show,
  ep,
  resume,
  publishableKey,
}: {
  show?: string;
  ep?: string;
  resume?: string;
  // Provided by the server (runtime read) so the client never depends on a
  // build-time-inlined NEXT_PUBLIC value — see lib/checkout-session.ts.
  publishableKey: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // `load` — the session could not be created or Stripe.js did not come up;
  // `expired` — the session was open when mounted and is not any more (a newer
  // checkout of this buyer closed it, #217). Both end in the same retry card,
  // with different words.
  const [failure, setFailure] = useState<"load" | "expired" | null>(null);
  // Create the session exactly once. The ref survives StrictMode's
  // mount→cleanup→mount in dev (same instance), so the action isn't called
  // twice — and since #217 a second call would not be a harmless replay: it
  // would create a second session and expire the first. No active/cleanup flag
  // on purpose — a per-pass flag from the discarded first StrictMode mount
  // would suppress the second pass's state update and hang the spinner. React
  // 19 no-ops setState on an unmounted component, so a late resolve after a
  // real unmount is harmless.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    createCheckoutSession({ show, ep, resume })
      .then(async (res) => {
        if (res.kind === "redirect") {
          router.replace(res.to);
        } else if (res.kind === "hosted") {
          window.location.assign(res.url);
        } else {
          // Embedded: confirm Stripe.js actually loaded with a usable
          // publishable key BEFORE mounting. The server decides embedded vs
          // hosted from a runtime env read; the client key is inlined at build
          // time. In the rare case they diverge (key present server-side but
          // absent from the client bundle), getStripeBrowser() resolves to
          // null and EmbeddedCheckoutProvider silently never initializes the
          // iframe — past the spinner guard, the buyer would be stuck on a
          // blank card. Surface the retry UI instead.
          const stripe = await getStripeBrowser(publishableKey);
          if (!stripe) {
            setFailure("load");
            return;
          }
          setSessionId(res.sessionId);
          setClientSecret(res.clientSecret);
        }
      })
      .catch(() => setFailure("load"));
  }, [show, ep, resume, router, publishableKey]);

  // The refocus probe (#217). Only while a session is mounted, only when the
  // tab becomes visible, one probe in flight at a time. A probe that fails
  // answers "open" on the server side, so nothing here can tear down a working
  // form by accident; only a definite "closed" does.
  useEffect(() => {
    if (!sessionId || failure) return;
    let probing = false;
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || probing) return;
      probing = true;
      checkoutSessionState(sessionId)
        .then((state) => {
          if (state === "closed") setFailure("expired");
        })
        .catch(() => {})
        .finally(() => {
          probing = false;
        });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [sessionId, failure]);

  if (failure) {
    return (
      <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
        <p className="text-sm font-medium text-white/75">
          {failure === "expired"
            ? t.checkout.expiredBody
            : t.checkout.errorBody}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-bold text-black transition-colors hover:bg-white/90"
        >
          {t.checkout.retry}
        </button>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center gap-4 py-16 text-center">
        <Spinner />
        <p className="text-sm font-medium text-white/55">{t.checkout.loading}</p>
      </div>
    );
  }

  // The embedded iframe renders Stripe's own (Dashboard-branded) checkout UI;
  // it auto-sizes its height. Wrapped on a light card so it reads on the dark
  // page even before Stripe's theme paints.
  return (
    <div className="mt-8 overflow-hidden rounded-2xl bg-white p-1 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.8)]">
      <EmbeddedCheckoutProvider
        stripe={getStripeBrowser(publishableKey)}
        options={{ clientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="size-6 animate-spin text-white/70"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
