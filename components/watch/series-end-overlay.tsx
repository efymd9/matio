"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { subscribeToShowReminder } from "@/app/watch/actions";
import { Icon } from "@/components/site/icon";
import { MatioLogo } from "@/components/site/matio-logo";
import { useT } from "@/lib/i18n/client";

// SSR-safe "are we on the client" flag. Same pattern as the other
// portal'd overlays in this folder — useSyncExternalStore lets us
// derive `mounted` without a setState-in-effect (which the React 19
// `react-hooks/set-state-in-effect` rule rejects).
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

// Rendered when the player's onEnded fires on the LAST episode of the
// show (i.e. there's no `next`). Replaces the spot the Up Next card
// would otherwise occupy. Captures an email into `show_reminders`;
// Resend isn't wired yet, so a future dispatch job is what actually
// turns these rows into emails.
export function SeriesEndOverlay({
  showId,
  showTitle,
  defaultEmail,
  onDismiss,
}: {
  showId: string;
  showTitle: string;
  defaultEmail?: string | null;
  onDismiss: () => void;
}) {
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const t = useT();

  const [email, setEmail] = useState(defaultEmail ?? "");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  // Focus the email input on mount when we have something for the user
  // to type into; focus the dismiss button instead in the success state
  // (the form is gone, but a sane focus target keeps keyboard nav
  // alive). Manual ref dance because useTransition doesn't expose a
  // "transition just finished" callback.
  const emailRef = useRef<HTMLInputElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state.kind === "success") dismissRef.current?.focus();
    else emailRef.current?.focus();
  }, [state.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state.kind === "submitting" || state.kind === "success") return;
    setState({ kind: "submitting" });
    startTransition(async () => {
      try {
        const result = await subscribeToShowReminder({ showId, email });
        if (result.ok) {
          setState({ kind: "success" });
          return;
        }
        // The server only returns two reasons; surface a copy line for
        // each. invalid_show should never happen via the UI (the slug
        // came from the page) — if it does we treat it as a generic
        // error so the user has a path forward.
        if (result.reason === "invalid_email") {
          setState({
            kind: "error",
            message: t.seriesEndOverlay.errorInvalidEmail,
          });
          return;
        }
        setState({
          kind: "error",
          message: t.seriesEndOverlay.errorGeneric,
        });
      } catch {
        setState({
          kind: "error",
          message: t.seriesEndOverlay.errorGeneric,
        });
      }
    });
  };

  if (!mounted) return null;

  const submitting = state.kind === "submitting" || isPending;
  const succeeded = state.kind === "success";
  const errorMessage = state.kind === "error" ? state.message : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.seriesEndOverlay.label}
      // Backdrop covers the whole player and intercepts clicks so the
      // media-chrome below can't toggle playback while the dialog is
      // up. The card itself centers on viewport, with safe-area
      // padding so notched / home-indicator phones don't clip it.
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] backdrop-blur-sm"
      onClick={(e) => {
        // Click on backdrop dismisses; click on card body does not
        // (target check rules out bubbled events from form controls).
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#0f0f12]/95 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:p-8">
        {/* Soft cinema-red glow behind the headline */}
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          aria-hidden
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 0%, rgba(255,61,61,0.22), transparent 60%)",
          }}
        />

        {/* Close button — accessible label, top-right corner, hit-area
            padded so coarse pointers (touch) get a comfortable target.
            Stays available in all states so the user can always exit. */}
        <button
          ref={dismissRef}
          type="button"
          onClick={onDismiss}
          aria-label={t.seriesEndOverlay.dismissAria}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
        >
          <Icon name="close" size={16} />
        </button>

        <div className="relative">
          <div className="flex justify-center">
            <MatioLogo size={14} accent="#ff3d3d" />
          </div>
          <p className="mt-4 text-center text-[11px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
            {t.seriesEndOverlay.kicker}
          </p>
          <h2 className="mt-2 text-center text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
            {t.seriesEndOverlay.headline(showTitle)}
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-center text-sm leading-relaxed text-white/65">
            {succeeded
              ? t.seriesEndOverlay.successBody
              : t.seriesEndOverlay.body}
          </p>

          {succeeded ? (
            <div className="mt-7">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#ff3d3d]/15">
                <Icon name="check" size={20} color="#ff3d3d" />
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-white text-sm font-bold text-black transition-colors hover:bg-white/90"
              >
                {t.seriesEndOverlay.closeCta}
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-7 space-y-3" noValidate>
              <label className="block">
                <span className="sr-only">
                  {t.seriesEndOverlay.emailLabel}
                </span>
                <input
                  ref={emailRef}
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  placeholder={t.seriesEndOverlay.emailPlaceholder}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    // Clear stale error message on edit so the user
                    // isn't shouted at while typing a fix.
                    if (state.kind === "error") setState({ kind: "idle" });
                  }}
                  disabled={submitting}
                  aria-invalid={state.kind === "error" || undefined}
                  aria-describedby={
                    errorMessage ? "series-end-email-error" : undefined
                  }
                  className="h-12 w-full rounded-md border border-white/15 bg-white/[0.06] px-4 text-sm text-white placeholder:text-white/40 transition-colors focus:border-[#ff3d3d]/70 focus:bg-white/[0.09] focus:outline-none disabled:opacity-50"
                />
              </label>
              {errorMessage ? (
                <p
                  id="series-end-email-error"
                  role="alert"
                  className="text-center text-xs text-[#ff7d7d]"
                >
                  {errorMessage}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#ff3d3d] text-sm font-bold text-white transition-colors hover:bg-[#ff5252] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? t.seriesEndOverlay.submitting
                  : t.seriesEndOverlay.submitCta}
              </button>
              <p className="text-center text-[11px] text-white/45">
                {t.seriesEndOverlay.privacyNote}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
