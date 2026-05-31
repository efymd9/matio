"use client";

import { useState } from "react";
import type { SeriesPoint } from "@/lib/admin-analytics";

// Interactive time-series: one metric at a time, switchable. SVG bars + area
// guide line, native-title tooltips. Client component only for the metric
// toggle — the data is computed server-side and passed in.

type MetricKey = "signups" | "trials" | "conversions" | "newSubs";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "trials", label: "Trials" },
  { key: "signups", label: "Signups" },
  { key: "conversions", label: "Conversions" },
  { key: "newSubs", label: "New subs" },
];

function fmtBucket(key: string, gran: string): string {
  // key is "YYYY-MM-DD HH:MM:SS" (UTC). Trim to the useful precision.
  const [date, time] = key.split(" ");
  if (gran === "hour") return `${date.slice(5)} ${time.slice(0, 5)}`;
  if (gran === "month") return date.slice(0, 7);
  return date.slice(5); // MM-DD
}

export function TimeSeriesChart({
  series,
  granularity,
}: {
  series: SeriesPoint[];
  granularity: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("trials");
  const values = series.map((p) => p[metric]);
  const max = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                metric === m.key
                  ? "bg-[#ff3d3d] text-white"
                  : "text-white/55 hover:text-white"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-white/45">
          {total.toLocaleString()} total
        </span>
      </div>

      {series.length === 0 ? (
        <p className="py-10 text-center text-sm text-white/55">
          No data in this range.
        </p>
      ) : (
        <>
          <div className="flex h-40 items-end gap-px">
            {series.map((p) => {
              const v = p[metric];
              return (
                <div
                  key={p.key}
                  className="group/bar flex h-full flex-1 flex-col items-center justify-end"
                  title={`${fmtBucket(p.key, granularity)} · ${v}`}
                >
                  <div
                    className={`w-full rounded-t-sm transition-colors ${
                      v > 0
                        ? "bg-[#ff3d3d]/60 group-hover/bar:bg-[#ff3d3d]"
                        : "bg-white/[0.04]"
                    }`}
                    style={{
                      height: `${Math.max((v / max) * 100, v > 0 ? 3 : 1)}%`,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-white/35">
            <span>{fmtBucket(series[0].key, granularity)}</span>
            <span>peak {max.toLocaleString()}</span>
            <span>{fmtBucket(series[series.length - 1].key, granularity)}</span>
          </div>
        </>
      )}
    </div>
  );
}
