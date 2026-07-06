"use client";

import { useState } from "react";
import type { SeriesPoint } from "@/lib/admin-analytics";
import { useAdminT } from "@/lib/i18n/admin-client";
import type { AdminDict } from "@/lib/i18n/admin-dictionaries";

// Interactive time-series: one metric at a time, switchable. SVG bars + area
// guide line, native-title tooltips. Client component only for the metric
// toggle — the data is computed server-side and passed in.

type MetricKey = "signups" | "trials" | "free" | "conversions" | "newSubs";

// Only the string-valued keys of the timeSeriesChart namespace (excludes the
// `total`/`peak` interpolation functions) so the resolved label is a string.
type MetricLabelKey = {
  [K in keyof AdminDict["timeSeriesChart"]]: AdminDict["timeSeriesChart"][K] extends string
    ? K
    : never;
}[keyof AdminDict["timeSeriesChart"]];

const METRICS: { key: MetricKey; labelKey: MetricLabelKey }[] = [
  { key: "trials", labelKey: "metricTrials" },
  { key: "free", labelKey: "metricFree" },
  { key: "signups", labelKey: "metricSignups" },
  { key: "conversions", labelKey: "metricConversions" },
  { key: "newSubs", labelKey: "metricNewSubs" },
];

// Free mode: previews / conversions / new subs receive no new data (see the
// free-pivot rule), so the toggle offers only the two live series. The `free`
// series is relabeled "Sessions" — in free mode it IS the traffic metric,
// not a tier.
const METRICS_FREE: { key: MetricKey; labelKey: MetricLabelKey }[] = [
  { key: "free", labelKey: "metricSessions" },
  { key: "signups", labelKey: "metricSignups" },
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
  freeMode = false,
}: {
  series: SeriesPoint[];
  granularity: string;
  freeMode?: boolean;
}) {
  const t = useAdminT();
  const metrics = freeMode ? METRICS_FREE : METRICS;
  const [metric, setMetric] = useState<MetricKey>(metrics[0].key);
  const values = series.map((p) => p[metric]);
  const max = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-1">
          {metrics.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                metric === m.key
                  ? "bg-gold text-gold-deep"
                  : "text-cream/55 hover:text-cream"
              }`}
            >
              {t.timeSeriesChart[m.labelKey]}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-cream/45">
          {t.timeSeriesChart.total(total.toLocaleString())}
        </span>
      </div>

      {series.length === 0 ? (
        <p className="py-10 text-center text-sm text-cream/55">
          {t.timeSeriesChart.noData}
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
                        ? "bg-gold/60 group-hover/bar:bg-gold"
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
          <div className="mt-2 flex justify-between font-mono text-[10px] text-cream/35">
            <span>{fmtBucket(series[0].key, granularity)}</span>
            <span>{t.timeSeriesChart.peak(max.toLocaleString())}</span>
            <span>{fmtBucket(series[series.length - 1].key, granularity)}</span>
          </div>
        </>
      )}
    </div>
  );
}
