"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";
import { CompleteRegistrationPixel } from "@/components/site/complete-registration-pixel";
import { Icon } from "@/components/site/icon";
import { OpenInBrowserHint } from "@/components/watch/open-in-browser-hint";
import { useT } from "@/lib/i18n/client";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";

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

  // Observability for the post-purchase surface: one outcome event per
  // render lifecycle. Deferred onto the consent-gated SDK like every other
  // mount-time event.
  useEffect(() => {
    if (phase === "signingIn") return;
    return onPostHogReady(() => {
      if (phase === "done") {
        capturePostHog("welcome_signin_succeeded", {
          method: ticket ? "ticket" : "session",
        });
      } else {
        capturePostHog("welcome_signin_failed", { reason: "ticket_error" });
      }
    });
  }, [phase, ticket]);

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
        reason="ticket_failed"
      />
    );
  }

  return (
    <div className="mt-4">
      {phase === "done" ? (
        <>
          <CompleteRegistrationPixel userId={userId} utm={utm} />
          <p className="text-sm text-cream/65">{t.welcome.ready}</p>
          <div className="mt-7 flex justify-center">
            <a
              href={destination}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gold-cta px-7 text-sm font-bold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-[transform,filter] duration-150 ease-out hover:brightness-110 active:scale-[0.98]"
            >
              <Icon name="play" size={14} color="#241205" />
              <span>{t.welcome.watchNow}</span>
            </a>
          </div>
        </>
      ) : (
        <p className="flex items-center justify-center gap-2 text-sm text-cream/65">
          <Spinner />
          {t.welcome.signingIn}
        </p>
      )}
      <p className="mt-6 text-[11px] text-cream/40">
        {t.welcome.accountEmail(maskedEmail)} {t.welcome.wrongEmail}
      </p>
    </div>
  );
}

// Degraded path: no claim cookie binding / not guest-born / mint failure /
// claim still activating. Self-hosted email-code sign-in — the account is
// passwordless, so the emailed code IS the credential. Replaces the old Clerk
// modal: its "Continue with Google" button is dead inside FB/IG webviews
// (Google blocks OAuth there) and the modal UX is cramped on small webviews;
// this form shows only the code path we actually support, plus a prominent
// "open in your browser" escape for webviews where Clerk's client is flaky.
export function WelcomeSignInFallback({
  destination,
  body,
  reason,
}: {
  destination: string;
  body: string;
  // Why the one-click flow degraded — for the welcome_fallback_shown event
  // (the page knows the branch; the client only reports it).
  reason: string;
}) {
  const t = useT();
  useEffect(() => {
    return onPostHogReady(() => {
      capturePostHog("welcome_fallback_shown", { reason });
    });
  }, [reason]);
  return (
    <div className="mt-4">
      <p className="text-center text-sm text-cream/65">{body}</p>
      <div className="mx-auto mt-1 max-w-sm">
        <OpenInBrowserHint />
      </div>
      <EmailCodeSignIn destination={destination} />
      <p className="mt-6 text-center text-[11px] text-cream/40">
        {t.welcome.wrongEmail}
      </p>
    </div>
  );
}

// Self-hosted, two-step email-code sign-in driven by the signal-based
// useSignIn (same surface ticket-sign-in uses): create({ identifier }) →
// emailCode.sendCode() → emailCode.verifyCode({ code }) → finalize() (sets the
// active session). On success we navigate to `destination` (the /welcome
// return URL), whose signed-in branch fires the deferred signup events before
// continuing to playback. The account is passwordless, so the emailed code is
// the only credential — an attacker who typed but doesn't control the email
// can't complete it.
function EmailCodeSignIn({ destination }: { destination: string }) {
  const t = useT();
  const router = useRouter();
  const { signIn } = useSignIn();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = !!signIn;

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!signIn || busy || !addr) return;
    setBusy(true);
    setError(null);
    try {
      const { error: createErr } = await signIn.create({ identifier: addr });
      if (createErr) {
        setError(t.welcome.codeSendFailed);
        return;
      }
      const { error: sendErr } = await signIn.emailCode.sendCode();
      if (sendErr) {
        setError(t.welcome.codeSendFailed);
        return;
      }
      setStep("code");
    } catch {
      setError(t.welcome.codeSendFailed);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!signIn || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: sendErr } = await signIn.emailCode.sendCode();
      if (sendErr) setError(t.welcome.codeSendFailed);
    } catch {
      setError(t.welcome.codeSendFailed);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!signIn || busy || !c) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verErr } = await signIn.emailCode.verifyCode({ code: c });
      if (verErr) {
        setError(t.welcome.codeWrong);
        return;
      }
      const { error: finErr } = await signIn.finalize();
      if (finErr) {
        // The code was already accepted; only session activation failed — don't
        // mislabel it "wrong code". Generic retry message instead.
        setError(t.welcome.ticketFailed);
        return;
      }
      // Session is live — go to the /welcome return URL (fires the deferred
      // signup events, then continues to playback). Show the spinner meanwhile.
      setDone(true);
      router.replace(destination);
    } catch {
      setError(t.welcome.codeWrong);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="mt-7 flex items-center justify-center gap-2 text-sm text-cream/65">
        <Spinner />
        {t.welcome.signingIn}
      </p>
    );
  }

  const inputCls =
    "h-12 w-full rounded-md border border-white/15 bg-white/[0.06] px-3.5 text-center text-base text-cream placeholder:text-cream/35 outline-none transition-colors focus:border-white/40 focus:bg-white/[0.09]";
  const submitCls =
    "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gold-cta px-7 text-sm font-bold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-[transform,filter] duration-150 ease-out hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100";

  return (
    <div className="mx-auto mt-5 max-w-sm">
      {step === "email" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder={t.welcome.emailPlaceholder}
            aria-label={t.welcome.emailLabel}
            className={inputCls}
          />
          <button type="submit" disabled={!ready || busy} className={submitCls}>
            {busy ? <Spinner /> : null}
            {busy ? t.welcome.sendingCode : t.welcome.sendCodeCta}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-center text-xs text-cream/55">
            {t.welcome.codeSentTo(email.trim())}
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(ev) => setCode(ev.target.value)}
            placeholder={t.welcome.codePlaceholder}
            aria-label={t.welcome.codeLabel}
            className={`${inputCls} tracking-[0.3em]`}
          />
          <button type="submit" disabled={!ready || busy} className={submitCls}>
            {busy ? <Spinner /> : null}
            {busy ? t.welcome.verifying : t.welcome.verifyCta}
          </button>
          <div className="flex items-center justify-center gap-4 pt-1 text-[11px]">
            <button
              type="button"
              onClick={resend}
              disabled={busy}
              className="font-semibold text-cream/70 underline underline-offset-2 transition-colors hover:text-cream disabled:opacity-50"
            >
              {t.welcome.resendCta}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              className="font-semibold text-cream/50 underline underline-offset-2 transition-colors hover:text-cream/80"
            >
              {t.welcome.changeEmail}
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p className="mt-3 text-center text-xs font-medium text-[#ff7a5e]">
          {error}
        </p>
      ) : null}
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
