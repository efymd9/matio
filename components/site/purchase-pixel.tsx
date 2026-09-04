"use client";

import { useEffect } from "react";
import { readConsentFromDocument } from "@/lib/cookie-consent";
import {
  measureOaiq,
  OAIQ_MEMBERSHIP_PLAN_ID,
  onOaiqReady,
} from "@/lib/openai-pixel-events";

// ChatGPT Ads `subscription_created` — the browser-side purchase beacon for
// PAID mode. Mounted on the two pages a buyer lands on straight from Stripe:
// /welcome (pay-first guests) and the signed-in return (watch page / home),
// both after the server has verified the Checkout Session at Stripe as PAID
// and belonging to this buyer (lib/checkout-return-verify.ts). Meta's Purchase
// is server-side (CAPI from the Stripe webhook); OpenAI's server Conversions
// API is not wired yet, so this is the only oaiq purchase signal — purchaseKey
// is the Stripe SUBSCRIPTION id, the same key CAPI uses, so a future server
// call dedupes against it by construction. Amount is what was actually charged today (the $1 trial fee, in
// cents — OpenAI's schema), mirroring TRIAL_FEE_VALUE for Meta.
//
// Once per session id via localStorage, burned only under LIVE consent (the
// SDK stays loaded after a withdrawal but drops events — see the same guard
// in complete-registration-pixel.tsx).
export function PurchasePixel({
  purchaseKey,
  amountCents,
  currency,
}: {
  purchaseKey: string;
  amountCents: number;
  currency: string;
}) {
  useEffect(() => {
    if (!purchaseKey) return;
    const key = `matio:oaiq:purchase:${purchaseKey}`;
    let done = false;
    try {
      done = !!localStorage.getItem(key);
    } catch {
      // Storage blocked: fire anyway; event_id dedupes on OpenAI's side.
    }
    if (done) return;
    return onOaiqReady(() => {
      if (readConsentFromDocument()?.marketing !== true) return;
      measureOaiq(
        "subscription_created",
        {
          type: "plan_enrollment",
          plan_id: OAIQ_MEMBERSHIP_PLAN_ID,
          amount: Math.max(0, Math.round(amountCents)),
          currency: currency.toUpperCase(),
        },
        { event_id: purchaseKey },
      );
      try {
        localStorage.setItem(key, "1");
      } catch {
        // ignore storage write failures
      }
    });
  }, [purchaseKey, amountCents, currency]);
  return null;
}
