import type { ReactNode } from "react";
import type Stripe from "stripe";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MatioLogo } from "@/components/site/matio-logo";
import { TicketSignIn, WelcomeSignInFallback } from "@/components/welcome/ticket-sign-in";
import { fromStripeMetadata } from "@/lib/attribution";
import {
  CHECKOUT_CLAIM_COOKIE,
  claimGuestCheckout,
  isGuestSubscription,
} from "@/lib/guest-checkout";
import { getDict } from "@/lib/i18n/server";
import { getStripe } from "@/lib/stripe";
import { mirrorSubscription } from "@/lib/subscription-mirror";

// Guest (pay-first) checkout success page. Deliberately OUTSIDE the
// /subscribe(.*) proxy auth matcher — the buyer has no session yet; that's
// the whole point. The page:
//   1. retrieves the Checkout Session server-side and requires a COMPLETED,
//      PAID, guest-flagged subscription session (the session_id in the URL
//      is untrusted input);
//   2. runs the same idempotent claim + mirror the Stripe webhook runs, so
//      whichever side lands first wins and the buyer's account+subscription
//      exist before they leave this page (no polling);
//   3. mints a one-click Clerk sign-in ticket ONLY when the httpOnly
//      checkout_claim cookie matches the session's client_reference_id.
//      The success URL is shareable/leakable (history, referrer); the
//      cookie binding is what proves "this browser paid". Without it the
//      page degrades to email-code sign-in with a masked email — NEVER to
//      token minting. Treat that check as load-bearing security code.
//
// The full checkout email is never rendered (masked only): the URL-borne
// session_id must not let a third party read the buyer's address.

export const metadata = {
  robots: { index: false, follow: false },
};

const SIGN_IN_TOKEN_TTL_SECONDS = 600;

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const lastDot = domain.lastIndexOf(".");
  const host = lastDot > 0 ? domain.slice(0, lastDot) : domain;
  const tld = lastDot > 0 ? domain.slice(lastDot) : "";
  const mask = (s: string) => (s ? `${s[0]}•••` : "•••");
  return `${mask(local)}@${mask(host)}${tld}`;
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{
    session_id?: string;
    show?: string;
    ep?: string;
    resume?: string;
  }>;
}) {
  const { session_id, show, ep, resume } = await searchParams;
  if (!session_id || !/^cs_[a-zA-Z0-9_]+$/.test(session_id)) redirect("/");

  // Where the buyer continues watching. Built from OUR params only —
  // user-controlled values land in the query string of a relative /watch
  // path, never in an absolute redirect.
  let destination = "/";
  if (show) {
    const params = new URLSearchParams();
    if (ep) params.set("ep", ep);
    if (resume) params.set("resume", resume);
    const qs = params.toString();
    destination = `/watch/${encodeURIComponent(show)}${qs ? `?${qs}` : ""}`;
  }

  // Where the email-code (fallback) sign-in returns to: back HERE, not
  // straight to the watch page. Re-entering /welcome signed-in renders the
  // "already signed in as buyer" branch, which mounts CompleteRegistration-
  // Pixel so Lead/CompleteRegistration/signup_completed fire for fallback
  // buyers too (the watch destination doesn't mount that pixel for
  // subscribers) before continuing to `destination`.
  const welcomeReturn = new URLSearchParams({ session_id });
  if (show) welcomeReturn.set("show", show);
  if (ep) welcomeReturn.set("ep", ep);
  if (resume) welcomeReturn.set("resume", resume);
  const welcomeReturnUrl = `/welcome?${welcomeReturn.toString()}`;

  let session: Stripe.Checkout.Session | null = null;
  try {
    session = await getStripe().checkout.sessions.retrieve(session_id, {
      expand: ["subscription"],
    });
  } catch {
    session = null;
  }
  if (
    !session ||
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.payment_status !== "paid"
  ) {
    redirect("/");
  }

  const sub = session.subscription;
  if (!sub || typeof sub === "string" || !isGuestSubscription(sub)) {
    // Non-guest sessions (the signed-in flow) never land here; a guest
    // session without an expanded subscription is a Stripe anomaly the
    // webhook will reconcile — nothing useful to render either way.
    redirect("/");
  }

  const { t } = await getDict();

  // Claim + mirror, same functions the webhook runs (both idempotent).
  // Failures degrade to the "still activating" state — the webhook retry
  // path heals server-side while the buyer can already email-code sign in
  // once the account exists.
  let claim: Awaited<ReturnType<typeof claimGuestCheckout>> | null = null;
  try {
    claim = await claimGuestCheckout(sub, {
      emailHint: session.customer_details?.email,
    });
    await mirrorSubscription(sub);
  } catch (err) {
    console.error("PAY_FIRST_ALERT welcome: guest claim/mirror failed", {
      sessionId: session.id,
      subId: sub.id,
      err,
    });
  }

  const shell = (content: ReactNode) => (
    <div className="relative min-h-screen overflow-hidden bg-background pb-16 pt-28 sm:pt-32">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(255,61,61,0.18), transparent 55%)",
        }}
      />
      <div className="relative mx-auto max-w-md px-6 text-center sm:px-8">
        <div className="flex justify-center">
          <MatioLogo size={20} accent="#ff3d3d" />
        </div>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
          {t.welcome.kicker}
        </p>
        <h1 className="mt-3 text-4xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-5xl">
          {t.welcome.title}
        </h1>
        {content}
      </div>
    </div>
  );

  // Claim failed (Clerk/DB hiccup): payment is in, account is still
  // materializing via webhook retries. Offer plain sign-in — no email to
  // mask, the buyer knows what they typed at Stripe.
  if (!claim) {
    return shell(
      <WelcomeSignInFallback
        destination={welcomeReturnUrl}
        body={t.welcome.claimPending}
        reason="claim_pending"
      />,
    );
  }

  const masked = maskEmail(claim.email);
  const { userId: activeUserId } = await auth();

  // Already signed in as the buyer (e.g. refresh after the ticket was
  // consumed): nothing to mint, just continue.
  if (activeUserId === claim.userId) {
    return shell(
      <TicketSignIn
        ticket={null}
        destination={destination}
        userId={claim.userId}
        maskedEmail={masked}
        utm={signupUtmFromMetadata(sub)}
      />,
    );
  }

  // The cookie binding: only the purchasing browser gets a sign-in ticket.
  const cookieToken = (await cookies()).get(CHECKOUT_CLAIM_COOKIE)?.value;
  const bound =
    !!cookieToken &&
    !!session.client_reference_id &&
    cookieToken === session.client_reference_id;

  // Mint a one-click sign-in ticket ONLY when ALL of:
  //  - the bound account is GUEST-BORN (claim.guestBorn) — born from a guest
  //    checkout for an email that had no prior Clerk account, so it can only be
  //    the buyer's. A pre-existing clerk_signup account is NOT guest-born: the
  //    typed-at-Stripe email might not belong to the buyer (Stripe doesn't
  //    verify ownership), so minting would be account takeover → email-code.
  //    Unlike the old per-call `created` check, guestBorn is race-proof: the
  //    webhook creating the account first no longer downgrades the buyer to
  //    email-code (the bug that stranded normal-browser guests).
  //  - the checkout_claim cookie matches client_reference_id (this is the
  //    browser that started THIS checkout — the binding that proves it). This
  //    cookie match is also what makes a leaked/replayed /welcome URL safe: a
  //    different browser has no matching cookie, so it can never mint a ticket.
  //  - no other user session is active.
  // Anything else → email-code sign-in (secure: the account is passwordless,
  // so the code is the credential — an attacker who typed but doesn't
  // control the email can't complete it). Return to /welcome after sign-in
  // so the deferred signup events still fire.
  if (!claim.guestBorn || !bound || activeUserId) {
    return shell(
      <WelcomeSignInFallback
        destination={welcomeReturnUrl}
        body={`${t.welcome.accountEmail(masked)} ${t.welcome.signInToWatch}`}
        reason={
          !claim.guestBorn
            ? "existing_account"
            : activeUserId
              ? "other_session"
              : "not_bound"
        }
      />,
    );
  }

  let ticket: string | null = null;
  try {
    const client = await clerkClient();
    const token = await client.signInTokens.createSignInToken({
      userId: claim.userId,
      expiresInSeconds: SIGN_IN_TOKEN_TTL_SECONDS,
    });
    ticket = token.token;
    // No need to clear the binding cookie here (and a Server Component can't
    // mutate cookies anyway): a history-replayed /welcome URL can only re-mint
    // from the SAME browser whose checkout_claim cookie still matches
    // client_reference_id — i.e. the buyer's own browser signing in again,
    // which is harmless (single-use, short-TTL ticket into their own account).
    // Any other browser fails the cookie binding and falls through to
    // email-code sign-in.
  } catch (err) {
    console.error("welcome: sign-in token mint failed", {
      userId: claim.userId,
      err,
    });
  }

  // Mint failed: same degraded path as a missing binding — the account
  // exists, email-code sign-in works, no session gets fabricated.
  if (!ticket) {
    return shell(
      <WelcomeSignInFallback
        destination={welcomeReturnUrl}
        body={`${t.welcome.ticketFailed} ${t.welcome.accountEmail(masked)}`}
        reason="ticket_mint_failed"
      />,
    );
  }

  return shell(
    <TicketSignIn
      ticket={ticket}
      destination={destination}
      userId={claim.userId}
      maskedEmail={masked}
      utm={signupUtmFromMetadata(sub)}
    />,
  );
}

// First-touch UTM for the deferred signup events, read from the same Stripe
// metadata the webhook uses (the page URL has no utm_* params by now).
function signupUtmFromMetadata(
  sub: Stripe.Subscription,
): Record<string, string> {
  const { first } = fromStripeMetadata(sub.metadata);
  const utm: Record<string, string> = {};
  if (first.source) utm.utm_source = first.source;
  if (first.medium) utm.utm_medium = first.medium;
  if (first.campaign) utm.utm_campaign = first.campaign;
  return utm;
}
