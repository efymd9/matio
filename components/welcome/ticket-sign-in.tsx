"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SignInButton, useSignIn } from "@clerk/nextjs";
import { CompleteRegistrationPixel } from "@/components/site/complete-registration-pixel";
import { Icon } from "@/components/site/icon";
import { useT } from "@/lib/i18n/client";

// Consumes the server-minted Clerk sign-in ticket on the /welcome page —
// the buyer paid as a guest and gets a session WITHOUT ever seeing a form.
// Uses the signal-based useSignIn (the installed @clerk/nextjs 7 surface):
// signIn.ticket({ ticket }) verifies the token, signIn.finalize() promotes
// the completed sign-in to the active session.
//
// ticket === null means the buyer's session is ALREADY active server-side
// (refresh after the ticket was consumed) — we skip straight to "done".
// Mint failures never reach this component; the page renders the sign-in
// fallback for those.
//
// Once the session is live we mount CompleteRegistrationPixel — the same
// deduped component /subscribe uses — so Lead/CompleteRegistration (Meta)
// and signup_completed (PostHog) still fire exactly once per user, just
// after Purchase instead of before it (pay-first reorders the funnel).
// Navigation is delayed a beat so those beacons leave before route change.
export function TicketSignIn({
  ticket,
  destination,
  userId,
  maskedEmail,
  utm,
}: {
  ticket: string | null;
  destination: string;
  userId: string;
  maskedEmail: string;
  utm?: Record<string, string>;
}) {
  const t = useT();
  const router = useRouter();
  const { signIn } = useSignIn();
  // null ticket + this component rendered ⇒ the server saw an active
  // session for this user already; treat as signed in.
  const [phase, setPhase] = useState<"signingIn" | "done" | "failed">(
    ticket ? "signingIn" : "done",
  );
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!ticket || !signIn || attemptedRef.current) return;
    // One-shot: the ticket is single-use, and this guard also makes the
    // effect safe to re-run when clerk-js finishes loading and useSignIn
    // swaps the pre-load proxy for the real resource (a new `signIn`
    // identity re-triggers the effect). We deliberately do NOT gate the
    // setPhase calls on a `cancelled` cleanup flag: on the normal cold
    // load the effect's cleanup fires the instant clerk-js loads (deps
    // change), which would otherwise discard the resolved done/failed
    // transition and strand the spinner forever. React no-ops setState on
    // an unmounted component, so unconditional calls are safe.
    attemptedRef.current = true;
    (async () => {
      try {
        const { error } = await signIn.ticket({ ticket });
        if (error) {
          setPhase("failed");
          return;
        }
        const { error: finalizeError } = await signIn.finalize();
        setPhase(finalizeError ? "failed" : "done");
      } catch {
        setPhase("failed");
      }
    })();
  }, [ticket, signIn]);

  useEffect(() => {
    if (phase !== "done") return;
    // Give the just-mounted pixel/PostHog beacons time to load + flush
    // before navigating. They survive an SPA route change once dispatched,
    // but the consent-gated SDKs can take a beat to load on a cold visit;
    // the destination (a subscriber /watch) does NOT re-mount
    // CompleteRegistrationPixel, so a fire missed here is lost. The
    // explicit "Watch now" button lets impatient users skip the wait.
    const timer = setTimeout(() => router.replace(destination), 3_000);
    return () => clearTimeout(timer);
  }, [phase, destination, router]);

  if (phase === "failed") {
    return (
      <WelcomeSignInFallback
        destination={destination}
        body={`${t.welcome.ticketFailed} ${t.welcome.accountEmail(maskedEmail)}`}
      />
    );
  }

  return (
    <div className="mt-4">
      {phase === "done" ? (
        <>
          <CompleteRegistrationPixel userId={userId} utm={utm} />
          <p className="text-sm text-white/65">{t.welcome.ready}</p>
          <div className="mt-7 flex justify-center">
            <a
              href={destination}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter] duration-150 ease-out hover:brightness-110 active:scale-[0.98]"
            >
              <Icon name="play" size={14} color="#ffffff" />
              <span>{t.welcome.watchNow}</span>
            </a>
          </div>
        </>
      ) : (
        <p className="flex items-center justify-center gap-2 text-sm text-white/65">
          <Spinner />
          {t.welcome.signingIn}
        </p>
      )}
      <p className="mt-6 text-[11px] text-white/40">
        {t.welcome.accountEmail(maskedEmail)} {t.welcome.wrongEmail}
      </p>
    </div>
  );
}

// Degraded path: no claim cookie binding / mint failure / claim still
// activating. Email-code sign-in via the standard Clerk modal — the
// account is passwordless, so the code IS the credential.
export function WelcomeSignInFallback({
  destination,
  body,
}: {
  destination: string;
  body: string;
}) {
  const t = useT();
  return (
    <div className="mt-4">
      <p className="text-sm text-white/65">{body}</p>
      <div className="mt-7 flex justify-center">
        <SignInButton
          mode="modal"
          forceRedirectUrl={destination}
          signUpForceRedirectUrl={destination}
        >
          <button
            type="button"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] px-7 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.7)] transition-[transform,filter] duration-150 ease-out hover:brightness-110 active:scale-[0.98]"
          >
            {t.welcome.signInCta}
          </button>
        </SignInButton>
      </div>
      <p className="mt-6 text-[11px] text-white/40">{t.welcome.wrongEmail}</p>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
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
