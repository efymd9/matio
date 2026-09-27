"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Icon } from "@/components/site/icon";
import { BURGUNDY_GLOW } from "@/lib/design";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { IdeasDict } from "@/lib/i18n/ideas-dictionaries";
import { localizedPath } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { TEXT_LINK } from "./ideas-parts";

// The Idea Submission Terms (#297): ONE sheet for the whole page, opened from
// tick 2 inside the form and from the FAQ's first answer below it.
//
// How the FAQ reaches it: the FAQ is server-rendered and handed to the form
// as `children`, and the form provides this context around it — so the FAQ's
// link is a tiny client island that reads the opener from its nearest
// provider. One sheet instance, one focus-return path (tick 2), no window
// events and no second copy of the Terms in the DOM.
const TermsOpenerContext = createContext<(() => void) | null>(null);
export const TermsOpenerProvider = TermsOpenerContext.Provider;

// "Idea Submission Terms" inside running text. A <button>, not a link: it
// opens a dialog over the draft and never navigates.
export function IdeasTermsLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const open = useContext(TermsOpenerContext);
  return (
    <button
      type="button"
      onClick={open ?? undefined}
      className={cn(
        TEXT_LINK,
        "cursor-pointer rounded-sm bg-transparent p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60",
        className,
      )}
    >
      {children}
    </button>
  );
}

// Below 834px a bottom sheet (92dvh, a handle); from 834px a centred 640px
// dialog, max 80vh, with its own scroll. Closes on the button, a tap on the
// scrim or Esc, and hands focus back to tick 2 (`finalFocus`) without
// scrolling the page — the draft underneath is never touched.
export function IdeasTermsSheet({
  open,
  onOpenChange,
  t,
  locale,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: IdeasDict;
  locale: Locale;
  finalFocus: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          // The scrim is a real close control for assistive tech too.
          render={
            <button type="button" tabIndex={-1} aria-label={t.terms.scrimAria} />
          }
          role="button"
          className="fixed inset-0 z-50 cursor-default bg-black/70 backdrop-blur-xs"
        />
        <Dialog.Popup
          finalFocus={finalFocus}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border border-rust/30 bg-espresso-2/95 backdrop-blur-2xl outline-none",
            // Phone: the bottom sheet. 92dvh with a vh fallback for Safari
            // < 15.4, which has no dynamic viewport units.
            "max-tablet:inset-x-0 max-tablet:bottom-0 max-tablet:h-[92vh] max-tablet:rounded-t-3xl max-tablet:border-b-0 max-tablet:shadow-sheet max-tablet:supports-[height:1dvh]:h-[92dvh]",
            // Tablet and up: the centred dialog.
            "tablet:left-1/2 tablet:top-1/2 tablet:max-h-[80vh] tablet:w-[640px] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-3xl tablet:shadow-dialog",
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 hidden h-[200px] tablet:block"
            style={{ backgroundImage: BURGUNDY_GLOW }}
          />
          <div aria-hidden className="flex flex-none justify-center pt-2.5 pb-1 tablet:hidden">
            <span className="block h-1 w-9 rounded-full bg-cream/35" />
          </div>
          <div className="relative flex flex-none flex-col gap-2 border-b border-rust/20 pt-2 pr-5 pb-4 pl-6 tablet:gap-2.5 tablet:pt-7 tablet:pr-6 tablet:pb-5 tablet:pl-8">
            <div className="flex items-center justify-between gap-4">
              <Dialog.Title className="font-display text-[22px] leading-[1.1] font-normal uppercase tracking-[0.01em] text-cream tablet:text-[28px]">
                {t.terms.title}
              </Dialog.Title>
              <Dialog.Close
                aria-label={t.terms.close}
                className="flex size-11 flex-none items-center justify-center rounded-full text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-cream/[0.08] tablet:size-11">
                  <Icon name="close" size={18} />
                </span>
              </Dialog.Close>
            </div>
            <p className="font-mono text-xs leading-normal tracking-[0.05em] text-cream/55">
              {t.terms.version}
            </p>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-6 pt-5 pb-[max(env(safe-area-inset-bottom),2.5rem)] text-sm leading-[1.6] text-cream/75 tablet:px-8 tablet:pt-6 tablet:pb-9 tablet:text-[15px]">
            <p>{t.terms.intro}</p>
            {t.terms.items.map((item) => (
              <p key={item.lead}>
                <span className="font-semibold text-cream">{item.lead}</span>{" "}
                {item.body}
              </p>
            ))}
            <p>
              <span className="font-semibold text-cream">{t.terms.data.lead}</span>{" "}
              {t.terms.data.before}
              <a
                href={`${localizedPath("/privacy", locale)}#ideas`}
                target="_blank"
                rel="noopener"
                className={TEXT_LINK}
              >
                {t.terms.data.link}
              </a>
              {t.terms.data.after}
            </p>
            <p>
              <span className="font-semibold text-cream">{t.terms.law.lead}</span>{" "}
              {t.terms.law.body}
            </p>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
