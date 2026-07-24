"use client";

import { Menu } from "@base-ui/react/menu";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { useLocale, useSetLocale, useT } from "@/lib/i18n/client";
import { isLocalizablePath, localizedPath, stripLocalePrefix } from "@/lib/seo";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/dictionaries";

// Dropdown menu picker. The trigger shows the current locale code; opening
// the menu reveals the full list with a checkmark next to the active row.
//
// Speed: locale flips are optimistic — useSetLocale updates the React
// context (and the client-visible cookie) synchronously, so every
// useT()/useLocale() consumer re-renders with the new dictionary on the
// same tick the user clicks. The server action + router.refresh that
// reconciles cookie state and async server components fires in the
// background.
//
// SEO: the rows are real <a href> (Menu.LinkItem) pointing at the current
// page's twin (/about ↔ /es/about), and the portal is keepMounted so those
// hrefs sit in the server-rendered HTML. This is the ONLY in-page link to the
// /es tree — without it Googlebot could reach Spanish solely through the
// sitemap's hreflang annotations. Clicks are still intercepted: navigating to
// the English URL while the locale cookie says `es` would just get 307'd back
// by proxy.ts, so setLocale() writes the cookie first, then navigates.
const OPTIONS: Locale[] = ["es", "en"];

export function LanguageSwitcher() {
  const locale = useLocale();
  const { setLocale, isPending } = useSetLocale();
  const t = useT();
  const pathname = usePathname();
  // On the non-localized surfaces (/watch, /subscribe) there's no twin URL —
  // the row self-links and the click handler does a cookie-only flip.
  const { path: basePath } = stripLocalePrefix(pathname);
  const hrefFor = (opt: Locale) =>
    isLocalizablePath(basePath) ? localizedPath(basePath, opt) : pathname;

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t.language.switchAria}
        className={cn(
          // Compact pill; expands its hit area to a 40px comfort target on
          // touch via pointer-coarse: variant.
          "inline-flex items-center rounded-full bg-cream/8 px-3.5 py-2 pointer-coarse:px-3.5 pointer-coarse:py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-cream/90 backdrop-blur-xl transition-colors hover:bg-cream/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60 data-[popup-open]:bg-cream/12",
          isPending && "opacity-70",
        )}
      >
        <span>{locale.toUpperCase()}</span>
      </Menu.Trigger>
      {/* keepMounted: the hrefs below must exist in the server-rendered HTML
          for crawlers, not only after the menu is opened. */}
      <Menu.Portal keepMounted>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup
            className="z-50 min-w-[8.5rem] rounded-2xl border border-rust/30 bg-espresso-2/95 p-1 text-sm text-cream shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur-xl outline-none data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95"
          >
            {OPTIONS.map((opt) => (
              <Menu.LinkItem
                key={opt}
                href={hrefFor(opt)}
                hrefLang={opt}
                aria-current={opt === locale ? "true" : undefined}
                closeOnClick
                onClick={(event) => {
                  // Let the browser handle new-tab/modified clicks natively.
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  setLocale(opt);
                }}
                className="relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 pl-7 text-sm font-medium text-cream/85 no-underline outline-none transition-colors data-[highlighted]:bg-cream/8 data-[highlighted]:text-cream"
              >
                {opt === locale && (
                  <span aria-hidden className="absolute left-2 inline-flex">
                    <Icon name="check" size={14} color="var(--color-gold)" />
                  </span>
                )}
                <span>{t.language[opt]}</span>
              </Menu.LinkItem>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
