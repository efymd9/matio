"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/site/icon";
import { MatioLogo } from "@/components/site/matio-logo";
import { useT } from "@/lib/i18n/client";

// SSR-safe "are we on the client" flag. Same pattern as the other
// portal'd overlays in this folder — useSyncExternalStore lets us
// derive `mounted` without a setState-in-effect.
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

// Rendered when the player's onEnded fires on the LAST episode of the
// show (i.e. there's no `next`). Just thanks the viewer — the email
// "Notify me when the next episode drops" form was here, but Resend
// isn't wired and a silently-broken promise is worse than no promise.
// The `subscribeToShowReminder` server action + `show_reminders` table
// stay in place for the next-iteration re-enable; this UI is the only
// callsite that fed them. To re-enable, restore the form, success and
// error JSX from the prior version (see git history before this
// commit) and the dict keys are still in lib/i18n/dictionaries.ts
// (seriesEndOverlay.submitCta, submitting, successBody, etc).
export function SeriesEndOverlay({
  showTitle,
  onDismiss,
}: {
  showId?: string;
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
  const dismissRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on mount so keyboard users have a clear exit.
  useEffect(() => {
    dismissRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.seriesEndOverlay.label}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-rust/30 bg-espresso-2/95 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:p-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          aria-hidden
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 0%, rgba(143,47,28,0.4), transparent 60%)",
          }}
        />

        <button
          type="button"
          onClick={onDismiss}
          aria-label={t.seriesEndOverlay.dismissAria}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-cream/65 transition-colors hover:bg-cream/10 hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream/60"
        >
          <Icon name="close" size={16} />
        </button>

        <div className="relative">
          <div className="flex justify-center">
            <MatioLogo size={16} />
          </div>
          <p className="mt-4 flex justify-center">
            <span className="rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream">
              {t.seriesEndOverlay.kicker}
            </span>
          </p>
          <h2 className="mt-3 text-center font-display text-2xl uppercase leading-tight tracking-[0.01em] text-cream sm:text-3xl">
            {t.seriesEndOverlay.headline(showTitle)}
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-center text-sm leading-relaxed text-cream/72">
            {t.seriesEndOverlay.body}
          </p>

          <button
            ref={dismissRef}
            type="button"
            onClick={onDismiss}
            className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-gold-cta text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform duration-150 ease-out active:scale-[0.98]"
          >
            {t.seriesEndOverlay.closeCta}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
