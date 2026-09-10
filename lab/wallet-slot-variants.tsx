import type { ReactNode } from "react";

import { TONE_GRADIENT, WALL_SCRIM } from "@/lib/design";
import { en } from "@/lib/i18n/dictionaries";

// Lab-first board for the paywall's in-place wallet slot (#210). The product
// ships variant A (the arrangement inside components/watch/paywall.tsx +
// wallet-express-checkout.tsx); B–E live ONLY here so the owner can look at
// all five live on a device and swap one in with a single decision.
//
// WHAT IS AND IS NOT BEING JUDGED HERE. The wallet button itself is a Stripe
// iframe rendering Apple's and Google's own artwork — its only knobs are
// height (40–55px), theme and verb, and Apple forbids building a look-alike.
// So the button is a fixed-size INERT PLACEHOLDER below, and the goldens pin
// the LAYOUT around it: where the slot sits relative to the card CTA, how the
// consent line reads, and what the wall looks like when the device offers no
// wallet at all. A golden that reached out to Stripe would be
// non-deterministic and would also be a picture of Apple's button, not ours.

// A–C take the consent copy straight from the product dictionary (#214), so
// they cannot show wording the paywall does not: one required box that is BOTH
// the Terms acceptance and the 14-day withdrawal waiver, plus a Privacy Policy
// notice beneath it that is not part of the "I agree". D is a deliberately
// terser ALTERNATIVE and its wording is not the product's.
const CONSENT = en.subscribe.walletConsent;
const legalLink = "font-bold text-gold underline underline-offset-2";

function ConsentText() {
  return (
    <>
      {CONSENT.beforeTerms}
      <a href="/terms" className={legalLink}>
        {CONSENT.terms}
      </a>
      {CONSENT.afterTerms}
    </>
  );
}

// `center` is for variant D, whose consent line is centred: an indented,
// left-aligned notice there sits visibly off the line above it. The default is
// unchanged, so A–C render exactly as before.
function PrivacyNotice({ center = false }: { center?: boolean }) {
  return (
    <p
      className={`mt-1.5 text-[10px] font-medium text-cream/45 ${
        center ? "text-center" : "pl-6.5 text-left"
      }`}
    >
      {CONSENT.privacyBefore}
      <a href="/privacy" className={legalLink}>
        {CONSENT.privacy}
      </a>
      {CONSENT.privacyAfter}
    </p>
  );
}
const CTA = "Continue · Subscribe";
const BENEFITS = "Every episode · Full catalogue · Cancel anytime";

/** The dimmed last frame the wall sits over, so layouts are judged over a
 *  picture rather than flat espresso. */
export function WallFrame({
  children,
  width = 640,
}: {
  children: ReactNode;
  width?: number;
}) {
  return (
    <div
      className="relative aspect-video overflow-hidden rounded-2xl bg-espresso-2"
      style={{ width, maxWidth: "100%", backgroundImage: TONE_GRADIENT.a }}
    >
      <div aria-hidden className="duotone-strong pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: WALL_SCRIM }}
      />
      {children}
    </div>
  );
}

/** Inert stand-in for the Stripe-rendered wallet button. Deliberately NOT an
 *  Apple Pay look-alike (Apple's guidelines forbid a self-made button) — it is
 *  a labelled grey slot at the real element height so the layout measures
 *  correctly. It marks where the button WILL appear: in the product nothing
 *  renders there until the box is ticked, so the sheet grows by this much at
 *  that moment — the caption says so, rather than the picture implying a
 *  button is live before consent. */
function WalletSlot({
  height = 48,
  label = "Apple Pay / Google Pay · appears once you agree",
}) {
  return (
    <div
      className="flex w-full items-center justify-center rounded-lg border border-dashed border-cream/25 bg-cream/10 text-[11px] font-semibold tracking-wide text-cream/50"
      style={{ height }}
    >
      {label}
    </div>
  );
}

function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 border-t border-rust/30 bg-espresso-2/95 px-5 pt-3 pb-5 backdrop-blur-2xl">
      <div className="mx-auto max-w-md text-center">
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-cream/20" />
        {children}
      </div>
    </div>
  );
}

function Heading() {
  return (
    <>
      <span className="inline-flex rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold tracking-[0.2em] text-cream uppercase">
        Continue watching
      </span>
      <h2 className="mt-3 font-display text-xl leading-tight tracking-[0.01em] text-cream uppercase">
        The Scarlet Oath <span className="text-cream/55">· S1·E3</span>
      </h2>
    </>
  );
}

const cardCta =
  "inline-flex h-[52px] w-full items-center justify-center rounded-full bg-gold-cta px-7 text-sm font-extrabold text-gold-deep shadow-cta";

const cardLink =
  "text-[11px] font-bold text-gold underline underline-offset-2";

// A — SHIPPED. Card CTA stays the primary action; the wallet slot sits beneath
// it behind a consent checkbox. Apple's Acceptable Use Guidelines want the
// wallet alongside other methods with equal prominence, and this is the
// smallest change to a wall that already converts.
export function WalletSlotStacked() {
  return (
    <Sheet>
      <Heading />
      <p className="mt-2 text-xs font-medium text-cream/45">{BENEFITS}</p>
      <div className="mt-4">
        <button type="button" className={cardCta}>
          {CTA}
        </button>
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-left">
        <input type="checkbox" readOnly className="mt-0.5 size-4 shrink-0 accent-gold" />
        <span className="text-[11px] leading-snug font-medium text-cream/60">
          <ConsentText />
        </span>
      </label>
      <PrivacyNotice />
      <div className="mt-3">
        <WalletSlot />
      </div>
    </Sheet>
  );
}

// B — "Wallet first". The wallet slot is the hero and the card path demotes to
// a text link. The most aggressive reading of the owner's ask; the risk is
// that a device with no wallet sees a near-empty sheet, so the link must carry
// real weight.
export function WalletSlotFirst() {
  return (
    <Sheet>
      <Heading />
      <p className="mt-2 text-xs font-medium text-cream/45">{BENEFITS}</p>
      <div className="mt-4">
        <WalletSlot height={54} />
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-left">
        <input type="checkbox" readOnly className="mt-0.5 size-4 shrink-0 accent-gold" />
        <span className="text-[11px] leading-snug font-medium text-cream/60">
          <ConsentText />
        </span>
      </label>
      <PrivacyNotice />
      <p className="mt-3 text-[11px] text-cream/55">
        Rather use a card? <span className={cardLink}>Pay with card</span>
      </p>
    </Sheet>
  );
}

// C — "Split". Wallet and card side by side above one shared consent line, so
// neither method reads as the fallback. Wide-viewport friendly; on a phone the
// two collapse to one column and it becomes A with a louder card button.
export function WalletSlotSplit() {
  return (
    <Sheet>
      <Heading />
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <WalletSlot label="Apple Pay · after you agree" />
        <button
          type="button"
          className="inline-flex h-12 items-center justify-center rounded-lg bg-gold-cta px-4 text-xs font-extrabold text-gold-deep shadow-cta"
        >
          Pay with card
        </button>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-left">
        <input type="checkbox" readOnly className="mt-0.5 size-4 shrink-0 accent-gold" />
        <span className="text-[11px] leading-snug font-medium text-cream/60">
          <ConsentText />
        </span>
      </label>
      <PrivacyNotice />
    </Sheet>
  );
}

// D — "Consent as one line". Same order as A, but the waiver is a single
// sentence with an inline tick rather than a checkbox block, to see how much
// of the sheet the legal text is really costing. NB: it is still an explicit,
// unticked opt-in — the shape changes, not the consent.
export function WalletSlotTerse() {
  return (
    <Sheet>
      <Heading />
      <div className="mt-4">
        <WalletSlot height={52} />
      </div>
      <label className="mt-2.5 flex cursor-pointer items-center justify-center gap-2">
        <input type="checkbox" readOnly className="size-3.5 shrink-0 accent-gold" />
        <span className="text-[10px] font-medium text-cream/50">
          Agree to the{" "}
          <a href="/terms" className={legalLink}>
            Terms
          </a>
          , start now, waive the 14-day withdrawal right
        </span>
      </label>
      <PrivacyNotice center />
      <div className="mt-3">
        <button type="button" className={cardCta}>
          {CTA}
        </button>
      </div>
    </Sheet>
  );
}

// E — "No wallet available". Not a fifth arrangement so much as the state the
// other four must degrade into: the device offers no wallet (no card in
// Wallet, private browsing, an unsupported browser), so the slot and its
// consent line vanish entirely and the wall is exactly what it is today. Worth
// a board seat because it is the majority state on desktop and in webviews.
export function WalletSlotAbsent() {
  return (
    <Sheet>
      <Heading />
      <p className="mt-2 text-sm font-medium text-cream/72">
        Subscribe to watch the full catalogue and every new episode.
      </p>
      <p className="mt-2 text-xs font-medium text-cream/45">{BENEFITS}</p>
      <div className="mt-4">
        <button type="button" className={cardCta}>
          {CTA}
        </button>
      </div>
      <p className="mt-2 text-[10px] text-cream/40">
        Cancel anytime from your account.
      </p>
    </Sheet>
  );
}
