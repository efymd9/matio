"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { MatioLogo } from "./matio-logo";
import { Icon } from "./icon";
import { LanguageSwitcher } from "./language-switcher";

// Sticky transparent → frosted-dark header. Hides on /watch (immersive
// fullscreen player) and /admin (own nav).
//
// Split into outer (route gating) + inner (scroll state) because React 19's
// `react-hooks/set-state-in-effect` rule forbids the initialize-from-window
// pattern via useEffect+setState. useSyncExternalStore is the documented
// replacement, but hooks must run unconditionally — so we keep the scroll
// subscription off /watch + /admin by mounting the inner only when needed.
export function SiteHeader({
  authSlot,
  paymentsEnabled,
}: {
  authSlot: React.ReactNode;
  // Server-read payments kill-switch (lib/free-mode.ts, passed from the
  // layout — this is a client component and can't read the env itself).
  // Off → the Subscribe nav links are hidden.
  paymentsEnabled: boolean;
}) {
  const pathname = usePathname();
  const hidden =
    pathname?.startsWith("/watch") || pathname?.startsWith("/admin");
  if (hidden) return null;
  // Show-detail pages carry their own mobile chrome per the 8a design
  // (circular back/share buttons over the hero, no site header below the
  // tablet breakpoint) — the persistent nav only appears from 834px up.
  const showDetail = pathname?.startsWith("/shows/") ?? false;
  return (
    <SiteHeaderContent
      authSlot={authSlot}
      paymentsEnabled={paymentsEnabled}
      mobileHidden={showDetail}
    />
  );
}

function subscribeToScroll(cb: () => void) {
  window.addEventListener("scroll", cb, { passive: true });
  return () => window.removeEventListener("scroll", cb);
}
function getScrolledSnapshot() {
  return window.scrollY > 24;
}
function getScrolledServerSnapshot() {
  return false;
}

function SiteHeaderContent({
  authSlot,
  paymentsEnabled,
  mobileHidden = false,
}: {
  authSlot: React.ReactNode;
  paymentsEnabled: boolean;
  mobileHidden?: boolean;
}) {
  const scrolled = useSyncExternalStore(
    subscribeToScroll,
    getScrolledSnapshot,
    getScrolledServerSnapshot,
  );
  const pathname = usePathname();
  const t = useT();

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background-color,backdrop-filter,border-color] duration-500 ease-out",
        mobileHidden && "hidden tablet:block",
        scrolled
          ? "border-b border-rust/20 bg-espresso/85 backdrop-blur-xl backdrop-saturate-150"
          : "border-b-0 bg-gradient-to-b from-espresso/70 via-espresso/25 to-transparent",
      )}
    >
      {/* Honor iOS landscape notch / Dynamic Island side insets while
          keeping the original 1.5rem/3rem floors at the sm: breakpoint. */}
      <div className="mx-auto flex max-w-screen-2xl items-center gap-8 py-4 pl-[max(env(safe-area-inset-left),1.5rem)] pr-[max(env(safe-area-inset-right),1.5rem)] sm:pl-[max(env(safe-area-inset-left),3rem)] sm:pr-[max(env(safe-area-inset-right),3rem)]">
        <Link
          href="/"
          className="group flex items-center transition-opacity hover:opacity-90"
          aria-label={t.header.home}
        >
          <MatioLogo size={22} className="tablet:hidden" />
          <MatioLogo size={24} className="hidden tablet:block" />
        </Link>
        {/* Negative-margin padding trick: visually compact but exposes a
            ~40px-tall hit area to touch + keyboard users without inflating
            the visual gap between siblings. */}
        <nav className="hidden gap-5 text-sm tablet:flex xl:gap-6">
          <NavLink href="/" active={pathname === "/"}>
            {t.header.browse}
          </NavLink>
          <NavLink href="/about" active={pathname === "/about"}>
            {t.footer.about}
          </NavLink>
          {paymentsEnabled && (
            <NavLink href="/subscribe" active={pathname === "/subscribe"}>
              {t.header.subscribe}
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <LanguageSwitcher />
          {authSlot}
          {/* Mobile-only nav disclosure — without it phones can't reach
              /about or /subscribe from the header (the inline nav above is
              tablet:flex-gated). Desktop/tablet hides the trigger. */}
          <MobileNavMenu t={t} paymentsEnabled={paymentsEnabled} />
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "-my-2 px-2 py-2 transition-colors",
        active
          ? "font-semibold text-cream"
          : "font-medium text-cream/70 hover:text-cream",
      )}
    >
      {children}
    </Link>
  );
}

function MobileNavMenu({
  t,
  paymentsEnabled,
}: {
  t: ReturnType<typeof useT>;
  paymentsEnabled: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t.header.menuAria}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-cream/8 text-cream/85 backdrop-blur-xl transition-colors hover:bg-cream/12 hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60 data-[popup-open]:bg-cream/12 tablet:hidden"
      >
        <Icon name="menu" size={22} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="z-50 min-w-[10rem] rounded-2xl border border-rust/30 bg-espresso-2/95 p-1 text-sm text-cream shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur-xl outline-none data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95">
            <Menu.Item
              closeOnClick
              className="block rounded-md px-3 py-2.5 text-sm font-medium text-cream/85 outline-none transition-colors data-[highlighted]:bg-cream/8 data-[highlighted]:text-cream"
              render={<Link href="/" />}
            >
              {t.header.browse}
            </Menu.Item>
            <Menu.Item
              closeOnClick
              className="block rounded-md px-3 py-2.5 text-sm font-medium text-cream/85 outline-none transition-colors data-[highlighted]:bg-cream/8 data-[highlighted]:text-cream"
              render={<Link href="/about" />}
            >
              {t.footer.about}
            </Menu.Item>
            {paymentsEnabled && (
              <Menu.Item
                closeOnClick
                className="block rounded-md px-3 py-2.5 text-sm font-medium text-cream/85 outline-none transition-colors data-[highlighted]:bg-cream/8 data-[highlighted]:text-cream"
                render={<Link href="/subscribe" />}
              >
                {t.header.subscribe}
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
