"use client";

import {
  useAdminLocale,
  useAdminSetLocale,
  useAdminT,
} from "@/lib/i18n/admin-client";
import {
  ADMIN_SUPPORTED_LOCALES,
  type AdminLocale,
} from "@/lib/i18n/admin-dictionaries";
import { cn } from "@/lib/utils";

// Compact RU | EN segmented toggle for the admin nav. Only two locales,
// so a one-click toggle beats the public header's dropdown
// (components/site/language-switcher.tsx). Flips are optimistic — the
// AdminLocaleProvider updates context + the client-visible cookie
// synchronously; the server action + router.refresh reconciles in the
// background.
export function AdminLocaleSwitcher() {
  const locale = useAdminLocale();
  const { setLocale, isPending } = useAdminSetLocale();
  const t = useAdminT();

  return (
    <div
      role="group"
      aria-label={t.language.switchAria}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-0.5",
        isPending && "opacity-70",
      )}
    >
      {ADMIN_SUPPORTED_LOCALES.map((opt: AdminLocale) => (
        <button
          key={opt}
          type="button"
          onClick={() => setLocale(opt)}
          aria-pressed={locale === opt}
          title={t.language[opt]}
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] transition-colors",
            locale === opt
              ? "bg-white/15 text-white"
              : "text-white/55 hover:text-white",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
