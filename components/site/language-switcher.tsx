"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/lib/i18n/client";
import { setLocale } from "@/lib/i18n/actions";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/dictionaries";

// Two-state segmented control: ES | EN. Calls the setLocale server action
// which writes the cookie and revalidates the root layout; we also fire
// router.refresh() so client components subscribed to the locale context
// pick up the new value on the next render.
const OPTIONS: Locale[] = ["es", "en"];

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const choose = (next: Locale) => {
    if (next === locale || isPending) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  };

  return (
    <div
      role="group"
      aria-label={t.language.switchAria}
      className={cn(
        "inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] p-0.5 text-[11px] font-bold uppercase tracking-[0.06em] backdrop-blur",
        isPending && "opacity-70",
      )}
    >
      {OPTIONS.map((opt) => {
        const active = opt === locale;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => choose(opt)}
            aria-pressed={active}
            disabled={isPending}
            className={cn(
              "rounded-full px-2.5 py-1 transition-colors disabled:cursor-wait",
              active
                ? "bg-white text-black"
                : "text-white/70 hover:text-white",
            )}
          >
            {opt.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
