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
// page's twin (/about ↔ /es/about). The portal is keepMounted so they're in
// the rendered DOM without opening the menu, but a portal emits nothing during
// SSR — the HTML-only crawlable link is AlternateLanguageLink (below, used in
// the footer). Clicks are intercepted in both: see useLocaleLinkHandler.
const OPTIONS: Locale[] = ["es", "en"];

// Flip to the other language, writing the cookie first. Shared by the header
// dropdown and the footer link: navigating straight to an English URL while
// the locale cookie says `es` would be 307'd back by proxy.ts, so the cookie
// has to land before the navigation. Modified clicks fall through to the
// browser's native new-tab handling.
function useLocaleLinkHandler(next: Locale) {
  const { setLocale } = useSetLocale();
  return (event: React.MouseEvent) => {
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
    setLocale(next);
  };
}

// Plain, always-server-rendered <a> to the current page's translation — the
// crawlable counterpart to the header dropdown. It has to exist outside the
// menu because Base UI renders the popup through a React portal, and portals
// emit NOTHING during SSR: the dropdown's hrefs only appear post-hydration, so
// on their own they leave the /es tree reachable only via sitemap annotations.
// Renders null on the non-localized surfaces (/watch, /subscribe), which have
// no twin URL.
export function AlternateLanguageLink({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  const pathname = usePathname();
  const other: Locale = locale === "es" ? "en" : "es";
  const onClick = useLocaleLinkHandler(other);
  const { path: basePath } = stripLocalePrefix(pathname);
  if (!isLocalizablePath(basePath)) return null;
  return (
    <a
      href={localizedPath(basePath, other)}
      hrefLang={other}
      onClick={onClick}
      className={className}
    >
      {t.language[other]}
    </a>
  );
}

function LocaleMenuRow({
  option,
  href,
  active,
  label,
}: {
  option: Locale;
  href: string;
  active: boolean;
  label: string;
}) {
  const onClick = useLocaleLinkHandler(option);
  return (
    <Menu.LinkItem
      href={href}
      hrefLang={option}
      aria-current={active ? "true" : undefined}
      closeOnClick
      onClick={onClick}
      className="relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 pl-7 text-sm font-medium text-cream/85 no-underline outline-none transition-colors data-[highlighted]:bg-cream/8 data-[highlighted]:text-cream"
    >
      {active && (
        <span aria-hidden className="absolute left-2 inline-flex">
          <Icon name="check" size={14} color="var(--color-gold)" />
        </span>
      )}
      <span>{label}</span>
    </Menu.LinkItem>
  );
}

export function LanguageSwitcher() {
  const locale = useLocale();
  const { isPending } = useSetLocale();
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
      {/* keepMounted so the rows' hrefs are in the RENDERED DOM without the
          menu being opened (Googlebot renders JS). It does NOT put them in the
          SSR HTML — this is a portal — which is why AlternateLanguageLink
          exists in the footer. */}
      <Menu.Portal keepMounted>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup
            className="z-50 min-w-[8.5rem] rounded-2xl border border-rust/30 bg-espresso-2/95 p-1 text-sm text-cream shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur-xl outline-none data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95"
          >
            {OPTIONS.map((opt) => (
              <LocaleMenuRow
                key={opt}
                option={opt}
                href={hrefFor(opt)}
                active={opt === locale}
                label={t.language[opt]}
              />
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
