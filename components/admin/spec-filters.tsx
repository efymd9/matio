"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAdminT } from "@/lib/i18n/admin-client";
import type { SpecFilters } from "@/lib/admin-analytics-v2";
import { SOURCE_BUCKETS } from "@/lib/analytics-spec-shared";

// Filter bar for the spec'd free-mode analytics dashboard. Same contract as
// the legacy AnalyticsFilters: all state lives in the URL search params
// (shareable, server-rendered); every control pushes a patched query and
// the server components re-query. Native controls only.

const PRESETS = ["7d", "30d", "90d"] as const;

const SOURCE_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  ig: "Instagram",
  fb: "Facebook",
  direct: "Direct",
  other: "Other",
};

export function SpecAnalyticsFilters({
  filters,
  countries,
  countryNames,
}: {
  filters: SpecFilters;
  /** ISO2 codes present in the data, sorted by volume */
  countries: string[];
  /** iso2 → display name (from the tile-grid dataset) */
  countryNames: Record<string, string>;
}) {
  const t = useAdminT();
  const ts = t.analyticsSpec;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const patch = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [router, pathname, sp],
  );

  const selectCls =
    "rounded-lg border border-white/10 bg-espresso-2 px-2.5 py-1.5 text-xs font-semibold text-cream outline-none transition-colors hover:border-white/20 focus:border-gold/60";

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 ${
        pending ? "opacity-60" : ""
      }`}
    >
      {/* Range presets */}
      <div className="flex overflow-hidden rounded-lg border border-white/10">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => patch({ range: p === "30d" ? null : p, from: null, to: null })}
            className={`px-3 py-1.5 text-xs font-bold transition-colors ${
              filters.preset === p
                ? "bg-gold text-gold-deep"
                : "bg-transparent text-cream/60 hover:text-cream"
            }`}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            patch({
              range: "custom",
              from: filters.customFrom ?? filters.from.toISOString().slice(0, 10),
              to: filters.customTo ?? filters.to.toISOString().slice(0, 10),
            })
          }
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${
            filters.preset === "custom"
              ? "bg-gold text-gold-deep"
              : "bg-transparent text-cream/60 hover:text-cream"
          }`}
        >
          {ts.filterCustom}
        </button>
      </div>
      {filters.preset === "custom" ? (
        <>
          <input
            type="date"
            defaultValue={filters.customFrom ?? ""}
            onChange={(e) => patch({ range: "custom", from: e.target.value })}
            className={selectCls}
            aria-label={ts.filterFrom}
          />
          <span className="text-cream/40">→</span>
          <input
            type="date"
            defaultValue={filters.customTo ?? ""}
            onChange={(e) => patch({ range: "custom", to: e.target.value })}
            className={selectCls}
            aria-label={ts.filterTo}
          />
        </>
      ) : null}

      {/* Source */}
      <select
        value={filters.source}
        onChange={(e) => patch({ src: e.target.value === "all" ? null : e.target.value })}
        className={selectCls}
        aria-label={ts.filterSource}
      >
        <option value="all">{ts.filterAllSources}</option>
        {SOURCE_BUCKETS.map((s) => (
          <option key={s} value={s}>
            {SOURCE_LABELS[s] ?? s}
          </option>
        ))}
      </select>

      {/* Country */}
      <select
        value={filters.country}
        onChange={(e) => patch({ geo: e.target.value === "all" ? null : e.target.value })}
        className={selectCls}
        aria-label={ts.filterCountry}
      >
        <option value="all">{ts.filterAllCountries}</option>
        {countries.map((c) => (
          <option key={c} value={c}>
            {countryNames[c] ?? c}
          </option>
        ))}
      </select>

      {/* Liveness window (pulse) */}
      <div className="ml-auto flex items-center gap-1.5 text-[11px] text-cream/45">
        <span>{ts.filterWindow}</span>
        <div className="flex overflow-hidden rounded-lg border border-white/10">
          {([7, 14] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => patch({ w: w === 7 ? null : String(w) })}
              className={`px-2.5 py-1 text-xs font-bold transition-colors ${
                filters.window === w
                  ? "bg-gold text-gold-deep"
                  : "bg-transparent text-cream/60 hover:text-cream"
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
