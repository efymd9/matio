"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckoutElementsProvider,
  ExpressCheckoutElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { createWalletCheckoutSession } from "@/app/checkout/actions";
import { reportWalletCheckoutStarted } from "@/app/subscribe/actions";
import type { CheckoutTargetInput } from "@/lib/checkout-session";
import { useT } from "@/lib/i18n/client";
import { capturePostHog } from "@/lib/posthog-events";
import { getStripeBrowser } from "@/lib/stripe-browser";

// Apple Pay / Google Pay, rendered INSIDE the paywall overlay so a viewer who
// hits the wall can pay without leaving the player (issue #210).
//
// The surface is Stripe's ExpressCheckoutElement driven by a `ui_mode:
// 'elements'` Checkout Session — the SAME Checkout Session object /checkout
// creates, so price, tax, the whole subscription metadata channel and every
// downstream webhook/mirror path are unchanged. Only the ToS consent moves
// here, because Stripe will not render it on this ui_mode (see
// lib/checkout-session-params.ts).
//
// WHY THE CONSENT CHECKBOX COMES FIRST. A Checkout Session must already exist
// before the Element can mount, and the waiver acceptance has to be on that
// session's metadata — so the box cannot be collected after the fact. Gating
// the session on it turns out to be the right thing twice over: a pre-ticked
// consent box is invalid under EU law anyway, and ticking it is a genuine
// INTENT signal, so we are not minting a Stripe session on every wall
// impression the way an eagerly-mounted element would.

type Props = {
  showSlug: string;
  episodeId?: string;
  resumeSeconds?: number;
  /** Runtime-read server-side and passed down — never a build-inlined value. */
  publishableKey: string | null;
};

export function WalletExpressCheckout(props: Props) {
  const t = useT();
  const [accepted, setAccepted] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // `null` = not asked yet, `false` = the server says this buyer has no wallet
  // surface (flag off, webview, anonymous, no publishable key). Never an error
  // banner: the paywall's own card CTA is the answer, and it is already there.
  const [available, setAvailable] = useState<boolean | null>(null);
  const startedRef = useRef(false);

  const { showSlug, episodeId, resumeSeconds, publishableKey } = props;

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    const input: CheckoutTargetInput = {
      show: showSlug,
      ep: episodeId ?? null,
      resume: resumeSeconds ? String(resumeSeconds) : null,
    };
    try {
      const res = await createWalletCheckoutSession(input, true);
      if (res.kind !== "wallet") {
        setAvailable(false);
        return;
      }
      // Confirm Stripe.js actually loaded with a usable key before we promise a
      // button — the server decides from a runtime env read, the client key is
      // build-inlined, and a divergence would leave a dead slot.
      const stripe = await getStripeBrowser(publishableKey);
      if (!stripe) {
        setAvailable(false);
        return;
      }
      setClientSecret(res.clientSecret);
      setSessionId(res.sessionId);
      setReturnUrl(res.returnUrl);
      setAvailable(true);
    } catch {
      setAvailable(false);
    }
  }, [showSlug, episodeId, resumeSeconds, publishableKey]);

  const onAccept = (next: boolean) => {
    setAccepted(next);
    if (next) void start();
  };

  return (
    <div className="mt-4">
      <label className="mx-auto flex max-w-md cursor-pointer items-start gap-2.5 text-left">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onAccept(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-gold"
        />
        <span className="text-[11px] leading-snug font-medium text-cream/60">
          {t.subscribe.withdrawalWaiver}
        </span>
      </label>

      {accepted && available === null ? (
        <p className="mt-3 text-[11px] font-medium text-cream/45">
          {t.checkout.loading}
        </p>
      ) : null}

      {accepted && clientSecret && returnUrl && sessionId ? (
        <div className="mx-auto mt-3 max-w-md">
          <CheckoutElementsProvider
            stripe={getStripeBrowser(publishableKey)}
            options={{ clientSecret }}
          >
            <WalletButton
              returnUrl={returnUrl}
              sessionId={sessionId}
              showSlug={showSlug}
              onUnavailable={() => setAvailable(false)}
            />
          </CheckoutElementsProvider>
        </div>
      ) : null}
    </div>
  );
}

// The button itself. Split out because it must live under the provider to call
// useCheckoutElements().
function WalletButton({
  returnUrl,
  sessionId,
  showSlug,
  onUnavailable,
}: {
  returnUrl: string;
  sessionId: string;
  showSlug: string;
  onUnavailable: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const checkout = useCheckoutElements();
  const [error, setError] = useState<string | null>(null);
  // A wallet confirm can resolve inline (no SCA), so `cancel` may arrive AFTER
  // a successful confirm — Stripe documents exactly that ordering. This ref is
  // what stops us treating it as "the buyer backed out" and re-arming a button
  // for a payment that already went through.
  const confirmedRef = useRef(false);

  const onConfirm = async (
    event: Parameters<
      NonNullable<React.ComponentProps<typeof ExpressCheckoutElement>["onConfirm"]>
    >[0],
  ) => {
    if (checkout.type !== "success") return;
    confirmedRef.current = true;

    // The checkout-intent signals fire HERE, not when the session was created:
    // this is the moment a buyer actually intended to pay, which is what
    // `checkout_started` has always meant in the saved PostHog funnels. Keyed
    // on the session id so Meta dedups against any replay. Never awaited into
    // the payment path beyond its own bounded clients.
    void reportWalletCheckoutStarted(sessionId).catch(() => {});
    capturePostHog("wallet_checkout_confirmed", { show_slug: showSlug });

    const result = await checkout.checkout.confirm({
      expressCheckoutConfirmEvent: event,
      returnUrl,
    });

    if (result.type === "error") {
      confirmedRef.current = false;
      setError(result.error.message);
      return;
    }

    // Success WITHOUT a redirect: an unauthenticated wallet payment resolves
    // inline and the buyer is still standing in the player. Navigate to the
    // same return URL a redirect would have used, so the existing verified
    // `cs=` leg runs — session re-read at Stripe, bound to this user's
    // customer, then the inline idempotent mirrorSubscription that closes the
    // redirect-before-webhook race. We deliberately do NOT paint subscriber
    // state from this success boolean: client-asserted subscription status is
    // exactly what the project forbids.
    router.push(returnUrl);
  };

  if (checkout.type === "error") {
    // The session failed to load — say nothing and let the card CTA stand.
    onUnavailable();
    return null;
  }

  return (
    <>
      <ExpressCheckoutElement
        // Stripe types this options object with all six keys required, and
        // these six are the ONLY knobs the element has — its rendering is
        // Apple's and Google's, by their brand rules, which is also why
        // tools/qa/no-magic-styles.sh has nothing to check inside it.
        // `subscribe` is the correct button verb for a membership; the wallets
        // are what we sell here, so nothing is reordered or filtered out.
        options={{
          buttonType: { applePay: "subscribe", googlePay: "subscribe" },
          buttonTheme: { applePay: "white", googlePay: "white" },
          buttonHeight: 48,
          layout: { maxColumns: 1, maxRows: 2, overflow: "auto" },
          paymentMethodOrder: ["apple_pay", "google_pay"],
          paymentMethods: { applePay: "auto", googlePay: "auto", link: "never" },
        }}
        onConfirm={onConfirm}
        onCancel={() => {
          if (!confirmedRef.current) setError(null);
        }}
        onLoadError={onUnavailable}
        onAvailablePaymentMethodsChange={(event) => {
          // The honest availability signal (the deprecated
          // `ready.availablePaymentMethods` is not it). `undefined` means this
          // browser/device offers no wallet at all — no card in Wallet, private
          // browsing, an unsupported browser — in which case the element
          // renders nothing and the card CTA above is the whole offer.
          if (!event.paymentMethods) onUnavailable();
        }}
      />
      {error ? (
        <p className="mt-2 text-[11px] font-medium text-cream/70">
          {t.checkout.errorBody}
        </p>
      ) : null}
    </>
  );
}
