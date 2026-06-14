"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { createCheckoutSession } from "@/app/checkout/actions";
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
export function CheckoutClient({
  show,
  ep,
  resume,
}: {
  show?: string;
  ep?: string;
  resume?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  // Create the session exactly once. The ref survives StrictMode's
  // mount→cleanup→mount in dev (same instance), so the action isn't called
  // twice; Stripe's hour-bucketed idempotency key is the backstop. No
  // active/cleanup flag on purpose — a per-pass flag from the discarded first
  // StrictMode mount would suppress the second pass's state update and hang the
  // spinner. React 19 no-ops setState on an unmounted component, so a late
  // resolve after a real unmount is harmless.
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
          const stripe = await getStripeBrowser();
          if (!stripe) {
            setErrored(true);
            return;
          }
          setClientSecret(res.clientSecret);
        }
      })
      .catch(() => setErrored(true));
  }, [show, ep, resume, router]);

  if (errored) {
    return (
      <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
        <p className="text-sm font-medium text-white/75">
          {t.checkout.errorBody}
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
        stripe={getStripeBrowser()}
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
