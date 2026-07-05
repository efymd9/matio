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
  return (
    <SiteHeaderContent authSlot={authSlot} paymentsEnabled={paymentsEnabled} />
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
}: {
  authSlot: React.ReactNode;
  paymentsEnabled: boolean;
}) {
  const scrolled = useSyncExternalStore(
    subscribeToScroll,
    getScrolledSnapshot,
    getScrolledServerSnapshot,
  );
  const t = useT();

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background-color,backdrop-filter,border-color] duration-500 ease-out",
        scrolled
          ? "border-b border-white/[0.06] bg-background/85 backdrop-blur-xl backdrop-saturate-150"
          : "border-b-0 bg-gradient-to-b from-background/70 via-background/25 to-transparent",
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
          <MatioLogo size={20} accent="#ff3d3d" color="#ffffff" />
        </Link>
        {/* Negative-margin padding trick: visually compact but exposes a
            ~40px-tall hit area to touch + keyboard users without inflating
            the visual gap between siblings. */}
        <nav className="hidden gap-5 text-sm font-medium text-white/70 sm:flex">
          <Link
            href="/"
            className="-my-2 px-2 py-2 transition-colors hover:text-white"
          >
            {t.header.browse}
          </Link>
          {paymentsEnabled && (
            <Link
              href="/subscribe"
              className="-my-2 px-2 py-2 transition-colors hover:text-white"
            >
              {t.header.subscribe}
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          {/* Mobile-only nav disclosure — without it phones can't reach
              /subscribe from the header (Browse/Subscribe links are
              sm:flex-gated). Desktop hides the trigger and renders the
              inline nav above instead. */}
          <MobileNavMenu t={t} paymentsEnabled={paymentsEnabled} />
          <LanguageSwitcher />
          {authSlot}
        </div>
      </div>
    </header>
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
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 data-[popup-open]:bg-white/[0.08] sm:hidden"
      >
        <Icon name="menu" size={22} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="z-50 min-w-[10rem] rounded-lg border border-white/10 bg-[#0f0f12]/95 p-1 text-sm text-white shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur-xl outline-none data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95">
            <Menu.Item
              closeOnClick
              className="block rounded-md px-3 py-2.5 text-sm font-medium text-white/85 outline-none transition-colors data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-white"
              render={<Link href="/" />}
            >
              {t.header.browse}
            </Menu.Item>
            {paymentsEnabled && (
              <Menu.Item
                closeOnClick
                className="block rounded-md px-3 py-2.5 text-sm font-medium text-white/85 outline-none transition-colors data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-white"
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
