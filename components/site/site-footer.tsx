"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COOKIE_PREFS_EVENT } from "@/lib/cookie-consent";
import { useT } from "@/lib/i18n/client";
import { MatioLogo } from "./matio-logo";

// Site-wide footer. Hidden on /watch (fullscreen player) and /admin
// (own layout). Carries the three legal links — required for live
// payments + GDPR Art. 13 — plus a few navigational shortcuts.
export function SiteFooter({
  paymentsEnabled,
}: {
  // Server-read payments kill-switch (lib/free-mode.ts, passed from the
  // layout). Off → the Subscribe link is hidden; "Manage subscription"
  // stays so legacy subscribers can still reach the Stripe portal.
  paymentsEnabled: boolean;
}) {
  const pathname = usePathname();
  const hidden =
    pathname?.startsWith("/watch") || pathname?.startsWith("/admin");
  if (hidden) return null;
  return <SiteFooterContent paymentsEnabled={paymentsEnabled} />;
}

function SiteFooterContent({ paymentsEnabled }: { paymentsEnabled: boolean }) {
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-rust/30 bg-espresso pl-[max(env(safe-area-inset-left),1.5rem)] pr-[max(env(safe-area-inset-right),1.5rem)] sm:pl-[max(env(safe-area-inset-left),3rem)] sm:pr-[max(env(safe-area-inset-right),3rem)]">
      {/* Mobile (<834): brand block, then a single wrapping link row.
          Tablet (834–1279): brand left, link columns right.
          Desktop (≥1280): 3-column grid with generous column gap. */}
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-8 py-10 tablet:flex-row tablet:items-start tablet:justify-between tablet:gap-10 tablet:py-12 xl:grid xl:grid-cols-[1fr_auto_auto] xl:gap-24 xl:pt-13 xl:pb-11">
        <div className="space-y-2.5 tablet:max-w-xs">
          <MatioLogo size={15} className="xl:hidden" />
          <MatioLogo size={17} className="hidden xl:block" />
          <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-gold/75 xl:text-[10px]">
            {t.footer.tagline}
          </p>
          <p className="hidden text-[11px] text-cream/35 tablet:block tablet:pb-[max(env(safe-area-inset-bottom),0px)] xl:hidden xl:pb-0">
            {t.footer.copyright(year)}
          </p>
        </div>

        {/* Mobile: wrapping inline link row. Hidden from tablet up, where
            the column layout below takes over. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-cream/55 tablet:hidden">
          <FooterLink href="/">{t.footer.browse}</FooterLink>
          <FooterLink href="/about">{t.footer.about}</FooterLink>
          {paymentsEnabled && (
            <FooterLink href="/subscribe">
              {t.footer.subscribe}
            </FooterLink>
          )}
          <FooterLink href="/api/billing-portal">
            {t.footer.manage}
          </FooterLink>
          <FooterLink href="/terms">{t.footer.terms}</FooterLink>
          <FooterLink href="/privacy">
            {t.footer.privacy}
          </FooterLink>
          <FooterLink href="/cookies">
            {t.footer.cookies}
          </FooterLink>
          <li>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new Event(COOKIE_PREFS_EVENT))
              }
              className="text-left transition-colors hover:text-cream focus-visible:outline-none focus-visible:underline focus-visible:underline-offset-2"
            >
              {t.footer.cookiePreferences}
            </button>
          </li>
        </ul>

        {/* Tablet + desktop: two labeled columns. */}
        <div className="hidden tablet:flex tablet:gap-14 xl:contents">
          <FooterColumn heading={t.footer.sectionMatio}>
            <FooterLink href="/">{t.footer.browse}</FooterLink>
            <FooterLink href="/about">{t.footer.about}</FooterLink>
            {paymentsEnabled && (
              <FooterLink href="/subscribe">{t.footer.subscribe}</FooterLink>
            )}
            <FooterLink href="/api/billing-portal">
              {t.footer.manage}
            </FooterLink>
          </FooterColumn>
          <FooterColumn heading={t.footer.sectionLegal}>
            <FooterLink href="/terms">{t.footer.terms}</FooterLink>
            <FooterLink href="/privacy">{t.footer.privacy}</FooterLink>
            <FooterLink href="/cookies">{t.footer.cookies}</FooterLink>
            <li>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new Event(COOKIE_PREFS_EVENT))
                }
                className="text-left text-sm text-cream/70 transition-colors hover:text-cream focus-visible:outline-none focus-visible:underline focus-visible:underline-offset-2"
              >
                {t.footer.cookiePreferences}
              </button>
            </li>
          </FooterColumn>
        </div>

        <p className="pb-[max(env(safe-area-inset-bottom),0px)] text-[11px] text-cream/35 tablet:hidden">
          {t.footer.copyright(year)}
        </p>
      </div>
      <div className="mx-auto hidden max-w-screen-2xl border-t border-cream/[0.06] py-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] text-xs text-cream/40 xl:block">
        {t.footer.copyright(year)}
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cream/45">
        {heading}
      </p>
      <ul className="space-y-2 text-sm text-cream/70">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="transition-colors hover:text-cream">
        {children}
      </Link>
    </li>
  );
}
