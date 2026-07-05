"use client";

import { Menu } from "@base-ui/react/menu";
import { Icon } from "./icon";
import { useLocale, useSetLocale, useT } from "@/lib/i18n/client";
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
const OPTIONS: Locale[] = ["es", "en"];

export function LanguageSwitcher() {
  const locale = useLocale();
  const { setLocale, isPending } = useSetLocale();
  const t = useT();

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
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup
            className="z-50 min-w-[8.5rem] rounded-2xl border border-rust/30 bg-espresso-2/95 p-1 text-sm text-cream shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur-xl outline-none data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95"
          >
            <Menu.RadioGroup
              value={locale}
              onValueChange={(next) => setLocale(next as Locale)}
            >
              {OPTIONS.map((opt) => (
                <Menu.RadioItem
                  key={opt}
                  value={opt}
                  closeOnClick
                  className="relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 pl-7 text-sm font-medium text-cream/85 outline-none transition-colors data-[highlighted]:bg-cream/8 data-[highlighted]:text-cream data-[checked]:text-cream"
                >
                  <Menu.RadioItemIndicator
                    className="absolute left-2 inline-flex"
                    render={
                      <span aria-hidden>
                        <Icon name="check" size={14} color="var(--color-gold)" />
                      </span>
                    }
                  />
                  <span>{t.language[opt]}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
