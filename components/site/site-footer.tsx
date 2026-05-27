"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { MatioLogo } from "./matio-logo";

// Site-wide footer. Hidden on /watch (fullscreen player) and /admin
// (own layout). Carries the three legal links — required for live
// payments + GDPR Art. 13 — plus a few navigational shortcuts.
export function SiteFooter() {
  const pathname = usePathname();
  const hidden =
    pathname?.startsWith("/watch") || pathname?.startsWith("/admin");
  if (hidden) return null;
  return <SiteFooterContent />;
}

function SiteFooterContent() {
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/[0.06] bg-background pl-[max(env(safe-area-inset-left),1.5rem)] pr-[max(env(safe-area-inset-right),1.5rem)] sm:pl-[max(env(safe-area-inset-left),3rem)] sm:pr-[max(env(safe-area-inset-right),3rem)]">
      <div className="mx-auto grid max-w-screen-2xl gap-10 py-12 sm:grid-cols-[1fr_auto_auto_auto] sm:gap-16 sm:py-16">
        <div className="space-y-3 sm:max-w-xs">
          <MatioLogo size={20} accent="#ff3d3d" color="#ffffff" />
          <p className="text-sm text-white/55">{t.footer.tagline}</p>
        </div>
        <FooterColumn heading={t.footer.sectionMatio}>
          <FooterLink href="/">{t.footer.browse}</FooterLink>
          <FooterLink href="/subscribe">{t.footer.subscribe}</FooterLink>
          <FooterLink href="/api/billing-portal">{t.footer.manage}</FooterLink>
        </FooterColumn>
        <FooterColumn heading={t.footer.sectionLegal}>
          <FooterLink href="/terms">{t.footer.terms}</FooterLink>
          <FooterLink href="/privacy">{t.footer.privacy}</FooterLink>
          <FooterLink href="/cookies">{t.footer.cookies}</FooterLink>
        </FooterColumn>
      </div>
      <div className="mx-auto max-w-screen-2xl border-t border-white/[0.04] py-5 text-[11px] text-white/40 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
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
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
        {heading}
      </p>
      <ul className="space-y-2 text-sm text-white/70">{children}</ul>
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
      <Link
        href={href}
        className="transition-colors hover:text-white"
      >
        {children}
      </Link>
    </li>
  );
}
