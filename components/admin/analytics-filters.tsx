"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  AnalyticsFilters,
  GranularityChoice,
} from "@/lib/admin-analytics";

// Sticky filter bar for /admin/analytics. All state lives in the URL search
// params (shareable, server-rendered); each control pushes a patched query and
// the server component re-queries. Native controls — no chart/UI dependency,
// fully keyboard-accessible, matches the cinema control-room theme.

const PRESETS: { key: string; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "all", label: "All" },
];

const GRANS: { key: GranularityChoice; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "hour", label: "Hourly" },
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

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
              {p.label}
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
            Custom
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
              aria-label="From date"
            />
            <span className="text-white/35">→</span>
            <input
              type="date"
              value={filters.customTo ?? ymd(filters.to)}
              min={filters.customFrom ?? undefined}
              onChange={(e) => patch({ range: "custom", to: e.target.value })}
              className={dateInput}
              aria-label="To date"
            />
          </div>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Granularity */}
          <Labeled label="Interval">
            <select
              value={filters.granularityChoice}
              onChange={(e) =>
                patch({ gran: e.target.value === "auto" ? null : e.target.value })
              }
              className={select}
            >
              {GRANS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </Labeled>

          {/* Show */}
          <Labeled label="Show">
            <select
              value={filters.show}
              onChange={(e) =>
                patch({ show: e.target.value === "all" ? null : e.target.value })
              }
              className={select}
            >
              <option value="all">All shows</option>
              {shows.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.title}
                </option>
              ))}
            </select>
          </Labeled>

          {/* Channel */}
          <Labeled label="Channel">
            <select
              value={filters.channel}
              onChange={(e) =>
                patch({
                  channel: e.target.value === "all" ? null : e.target.value,
                })
              }
              className={select}
            >
              <option value="all">All channels</option>
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Labeled>

          {/* Campaign */}
          <Labeled label="Campaign">
            <select
              value={filters.campaign}
              onChange={(e) =>
                patch({
                  campaign: e.target.value === "all" ? null : e.target.value,
                })
              }
              className={select}
            >
              <option value="all">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Labeled>

          {/* Status scope */}
          <Labeled label="Subs">
            <select
              value={filters.status}
              onChange={(e) =>
                patch({ status: e.target.value === "ag" ? null : e.target.value })
              }
              className={select}
            >
              <option value="ag">Access-granting</option>
              <option value="active">Active only</option>
              <option value="all">All statuses</option>
            </select>
          </Labeled>

          {/* Attribution toggle */}
          <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-1">
            <button
              type="button"
              onClick={() => patch({ attr: null })}
              className={chip(filters.attribution === "first")}
            >
              First-touch
            </button>
            <button
              type="button"
              onClick={() => patch({ attr: "last" })}
              className={chip(filters.attribution === "last")}
            >
              Last-touch
            </button>
          </div>

          {/* Reset */}
          <button
            type="button"
            onClick={() => router.push(pathname, { scroll: false })}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white/45 transition-colors hover:text-white"
          >
            Reset
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
