"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAdminT } from "@/lib/i18n/admin-client";
import type { AdminDict } from "@/lib/i18n/admin-dictionaries";
import type {
  AnalyticsFilters,
  GranularityChoice,
} from "@/lib/admin-analytics";

// Sticky filter bar for /admin/analytics. All state lives in the URL search
// params (shareable, server-rendered); each control pushes a patched query and
// the server component re-queries. Native controls — no chart/UI dependency,
// fully keyboard-accessible, matches the cinema control-room theme.

// Keys stay at module scope; display labels resolve at render via the dict.
// The 24h/7d/30d/90d preset labels are language-neutral tokens and stay as-is;
// only the "all" preset label translates.
const PRESETS: { key: string; label: string | null }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "all", label: null },
];

const GRANS: { key: GranularityChoice }[] = [
  { key: "auto" },
  { key: "hour" },
  { key: "day" },
  { key: "week" },
  { key: "month" },
];

function granLabel(t: AdminDict, key: GranularityChoice): string {
  switch (key) {
    case "auto":
      return t.analyticsFilters.granularityAuto;
    case "hour":
      return t.analyticsFilters.granularityHourly;
    case "day":
      return t.analyticsFilters.granularityDaily;
    case "week":
      return t.analyticsFilters.granularityWeekly;
    case "month":
      return t.analyticsFilters.granularityMonthly;
  }
}

export function AnalyticsFilters({
  filters,
  shows,
  channels,
  campaigns,
}: {
  filters: AnalyticsFilters;
  shows: { slug: string; title: string }[];
  channels: string[];
  campaigns: string[];
}) {
  const t = useAdminT();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Merge a patch into the current query and navigate. Empty-string / null
  // values delete the key (back to default). Scroll preserved.
  const patch = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [router, pathname, sp],
  );

  const isCustom = filters.preset === "custom";

  return (
    <div
      className={`sticky top-[60px] z-20 -mx-2 rounded-2xl border border-white/[0.06] bg-background/85 px-3 py-3 backdrop-blur-xl transition-opacity sm:px-4 ${
        pending ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Date presets */}
        <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => patch({ range: p.key, from: null, to: null })}
              className={chip(filters.preset === p.key)}
            >
              {p.label ?? t.analyticsFilters.presetAll}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              patch({
                range: "custom",
                from: filters.customFrom ?? ymd(filters.from),
                to: filters.customTo ?? ymd(filters.to),
              })
            }
            className={chip(isCustom)}
          >
            {t.analyticsFilters.customPreset}
          </button>
        </div>

        {/* Custom date range inputs */}
        {isCustom ? (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={filters.customFrom ?? ymd(filters.from)}
              max={filters.customTo ?? undefined}
              onChange={(e) => patch({ range: "custom", from: e.target.value })}
              className={dateInput}
              aria-label={t.analyticsFilters.fromDateAria}
            />
            <span className="text-white/35">→</span>
            <input
              type="date"
              value={filters.customTo ?? ymd(filters.to)}
              min={filters.customFrom ?? undefined}
              onChange={(e) => patch({ range: "custom", to: e.target.value })}
              className={dateInput}
              aria-label={t.analyticsFilters.toDateAria}
            />
          </div>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Granularity */}
          <Labeled label={t.analyticsFilters.intervalLabel}>
            <select
              value={filters.granularityChoice}
              onChange={(e) =>
                patch({ gran: e.target.value === "auto" ? null : e.target.value })
              }
              className={select}
            >
              {GRANS.map((g) => (
                <option key={g.key} value={g.key}>
                  {granLabel(t, g.key)}
                </option>
              ))}
            </select>
          </Labeled>

          {/* Show */}
          <Labeled label={t.analyticsFilters.showLabel}>
            <select
              value={filters.show}
              onChange={(e) =>
                patch({ show: e.target.value === "all" ? null : e.target.value })
              }
              className={select}
            >
              <option value="all">{t.analyticsFilters.allShows}</option>
              {shows.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.title}
                </option>
              ))}
            </select>
          </Labeled>

          {/* Channel */}
          <Labeled label={t.analyticsFilters.channelLabel}>
            <select
              value={filters.channel}
              onChange={(e) =>
                patch({
                  channel: e.target.value === "all" ? null : e.target.value,
                })
              }
              className={select}
            >
              <option value="all">{t.analyticsFilters.allChannels}</option>
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Labeled>

          {/* Campaign */}
          <Labeled label={t.analyticsFilters.campaignLabel}>
            <select
              value={filters.campaign}
              onChange={(e) =>
                patch({
                  campaign: e.target.value === "all" ? null : e.target.value,
                })
              }
              className={select}
            >
              <option value="all">{t.analyticsFilters.allCampaigns}</option>
              {campaigns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Labeled>

          {/* Status scope */}
          <Labeled label={t.analyticsFilters.subsLabel}>
            <select
              value={filters.status}
              onChange={(e) =>
                patch({ status: e.target.value === "ag" ? null : e.target.value })
              }
              className={select}
            >
              <option value="ag">{t.analyticsFilters.statusAccessGranting}</option>
              <option value="active">{t.analyticsFilters.statusActiveOnly}</option>
              <option value="all">{t.analyticsFilters.statusAll}</option>
            </select>
          </Labeled>

          {/* Attribution toggle */}
          <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-1">
            <button
              type="button"
              onClick={() => patch({ attr: null })}
              className={chip(filters.attribution === "first")}
            >
              {t.analyticsFilters.firstTouch}
            </button>
            <button
              type="button"
              onClick={() => patch({ attr: "last" })}
              className={chip(filters.attribution === "last")}
            >
              {t.analyticsFilters.lastTouch}
            </button>
          </div>

          {/* Reset */}
          <button
            type="button"
            onClick={() => router.push(pathname, { scroll: false })}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white/45 transition-colors hover:text-white"
          >
            {t.analyticsFilters.reset}
          </button>
        </div>
      </div>
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40">
        {label}
      </span>
      {children}
    </label>
  );
}

function chip(active: boolean): string {
  return `rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
    active
      ? "bg-[#ff3d3d] text-white shadow-[0_4px_14px_-6px_rgba(255,61,61,0.8)]"
      : "text-white/55 hover:text-white"
  }`;
}

const select =
  "h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs font-medium text-white outline-none transition-colors hover:border-white/20 focus-visible:border-[#ff3d3d]/70 [&>option]:bg-[#15151a] [&>option]:text-white";

const dateInput =
  "h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs font-medium text-white outline-none transition-colors hover:border-white/20 focus-visible:border-[#ff3d3d]/70 [color-scheme:dark]";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
