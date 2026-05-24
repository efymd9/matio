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
          // Compact pill on desktop; expands its hit area to a 40px
          // comfort target on touch via pointer-coarse: variant.
          "inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 pointer-coarse:px-3 pointer-coarse:py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-white/85 backdrop-blur transition-colors hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 data-[popup-open]:bg-white/[0.08]",
          isPending && "opacity-70",
        )}
      >
        <span>{locale.toUpperCase()}</span>
        <Icon name="chevron-down" size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup
            className="z-50 min-w-[8.5rem] rounded-lg border border-white/10 bg-[#0f0f12]/95 p-1 text-sm text-white shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur-xl outline-none data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95"
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
                  className="relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 pl-7 text-sm font-medium text-white/85 outline-none transition-colors data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-white data-[checked]:text-white"
                >
                  <Menu.RadioItemIndicator
                    className="absolute left-2 inline-flex"
                    render={
                      <span aria-hidden>
                        <Icon name="check" size={14} color="#ff3d3d" />
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
