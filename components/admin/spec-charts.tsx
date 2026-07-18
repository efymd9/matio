import type { PulseData, RetentionCurve } from "@/lib/admin-analytics-v2";

// Chart primitives for the spec'd free-mode analytics dashboard. Server
// components — static SVG, native <title> tooltips, no client JS (same
// idiom as components/admin/charts.tsx). Labels arrive as props so these
// stay dict-free.
//
// Palette (validated against the espresso #0f0a07 surface with the dataviz
// six-checks script — lightness band, CVD ΔE, normal-vision floor,
// contrast all PASS): categorical chain green/blue/gold for the stacked
// actives + WAU line; the loss red is a STATUS color, separated
// positionally (below the zero line) and always labeled, never
// color-alone.
const NEW_GREEN = "#46a344";
const RET_BLUE = "#3b82d4";
const WAU_GOLD = "#b3872d";
const LOST_RED = "#d24b3b";
// Single-series accent for the retention curve / dot plot (brand gold).
const ACCENT = "#e6b366";

function fmtMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---- Block 2: pulse — WAU line over daily new/returning/lost bars ----------

export type PulseLabels = {
  wau: string;
  newUsers: string;
  returning: string;
  lost: string;
  release: string;
};

export function PulseChart({
  data,
  labels,
}: {
  data: PulseData;
  labels: PulseLabels;
}) {
  const { points, releases } = data;
  const n = points.length;
  if (n === 0) return null;

  const W = 760;
  const H = 240;
  const ML = 40;
  const MR = 10;
  const MT = 10;
  const MB = 24;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;

  const posMax = Math.max(
    ...points.map((p) => Math.max(p.wau, p.newUsers + p.returning)),
    1,
  );
  const negMax = Math.max(...points.map((p) => p.lost), 0);
  // Loss lane: proportional, but bounded so a bad week can't crush the
  // main lane (and always visible when any loss exists).
  const negFrac =
    negMax > 0
      ? Math.min(0.35, Math.max(0.12, negMax / (posMax + negMax)))
      : 0;
  const posH = plotH * (1 - negFrac);
  const negH = plotH - posH;
  const zeroY = MT + posH;
  const yPos = (v: number) => zeroY - (v / posMax) * posH;
  const yNeg = (v: number) => zeroY + (negMax > 0 ? (v / negMax) * negH : 0);

  const step = plotW / n;
  const barW = Math.min(step * 0.68, 26);
  const xCenter = (i: number) => ML + i * step + step / 2;

  const wauPath = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${xCenter(i).toFixed(1)},${yPos(p.wau).toFixed(1)}`,
    )
    .join("");

  // ≤8 x labels, always including the first and last day.
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const releasesByDay = new Map<string, string[]>();
  for (const r of releases) {
    const list = releasesByDay.get(r.day) ?? [];
    list.push(`${r.showTitle} — E${r.episodeNumber}`);
    releasesByDay.set(r.day, list);
  }

  // Positive-lane gridlines at "nice" fractions.
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => ({
    v: Math.round(posMax * f),
    y: yPos(posMax * f),
  }));

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={labels.wau}
      >
        {ticks.map((t) => (
          <g key={t.v}>
            <line
              x1={ML}
              x2={W - MR}
              y1={t.y}
              y2={t.y}
              stroke="#f6efe4"
              strokeOpacity="0.07"
            />
            <text
              x={ML - 5}
              y={t.y + 3}
              textAnchor="end"
              className="fill-cream/35 text-[9px] font-mono"
            >
              {t.v}
            </text>
          </g>
        ))}
        {/* zero line */}
        <line
          x1={ML}
          x2={W - MR}
          y1={zeroY}
          y2={zeroY}
          stroke="#f6efe4"
          strokeOpacity="0.22"
        />

        {/* daily balance bars: actives stacked up, lost down */}
        {points.map((p, i) => {
          const x = xCenter(i) - barW / 2;
          const newH = zeroY - yPos(p.newUsers);
          const retH = zeroY - yPos(p.returning);
          const lostH = yNeg(p.lost) - zeroY;
          return (
            <g key={p.day}>
              {p.newUsers > 0 ? (
                <rect
                  x={x}
                  y={yPos(p.newUsers)}
                  width={barW}
                  height={Math.max(newH, 1.5)}
                  rx={1.5}
                  fill={NEW_GREEN}
                />
              ) : null}
              {p.returning > 0 ? (
                // 2px gap between stacked segments (mark spec).
                <rect
                  x={x}
                  y={yPos(p.newUsers + p.returning) }
                  width={barW}
                  height={Math.max(retH - (p.newUsers > 0 ? 2 : 0), 1.5)}
                  rx={1.5}
                  fill={RET_BLUE}
                />
              ) : null}
              {p.lost > 0 ? (
                <rect
                  x={x}
                  y={zeroY + 2}
                  width={barW}
                  height={Math.max(lostH - 2, 1.5)}
                  rx={1.5}
                  fill={LOST_RED}
                />
              ) : null}
            </g>
          );
        })}

        {/* release markers */}
        {[...releasesByDay.entries()].map(([day, titles]) => {
          const i = points.findIndex((p) => p.day === day);
          if (i < 0) return null;
          const x = xCenter(i);
          return (
            <g key={day}>
              <line
                x1={x}
                x2={x}
                y1={MT}
                y2={zeroY + negH}
                stroke={ACCENT}
                strokeOpacity="0.5"
                strokeDasharray="3 3"
              />
              <text
                x={x}
                y={MT + 8}
                textAnchor="middle"
                className="text-[9px]"
                fill={ACCENT}
              >
                ▾<title>{`${labels.release}: ${titles.join(", ")}`}</title>
              </text>
            </g>
          );
        })}

        {/* WAU line above everything */}
        <path
          d={wauPath}
          fill="none"
          stroke={WAU_GOLD}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* x labels + per-day hover targets */}
        {points.map((p, i) => (
          <g key={p.day}>
            {i % labelEvery === 0 || i === n - 1 ? (
              <text
                x={xCenter(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-cream/35 text-[8.5px] font-mono"
              >
                {p.day.slice(5)}
              </text>
            ) : null}
            <rect
              x={ML + i * step}
              y={MT}
              width={step}
              height={plotH}
              fill="transparent"
            >
              <title>
                {`${p.day}\n${labels.wau}: ${p.wau}\n${labels.newUsers}: ${p.newUsers} · ${labels.returning}: ${p.returning} · ${labels.lost}: ${p.lost}`}
              </title>
            </rect>
          </g>
        ))}
      </svg>
      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-cream/60">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ background: WAU_GOLD }}
          />
          {labels.wau}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: NEW_GREEN }}
          />
          {labels.newUsers}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: RET_BLUE }}
          />
          {labels.returning}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: LOST_RED }}
          />
          {labels.lost}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-[10px]" style={{ color: ACCENT }}>
            ▾
          </span>
          {labels.release}
        </span>
      </div>
    </div>
  );
}

// ---- Block 6: per-episode audience-retention curve -------------------------

export type CurveLabels = {
  yAxis: string; // "% of starts"
  views: string;
  noData: string;
};

export function RetentionCurveChart({
  curve,
  labels,
}: {
  curve: RetentionCurve;
  labels: CurveLabels;
}) {
  const starts = curve.buckets[0]?.views ?? 0;
  if (starts <= 0) {
    return (
      <p className="py-8 text-center text-sm text-cream/55">{labels.noData}</p>
    );
  }
  const pts = curve.buckets.map((b) => ({
    bucket: b.bucket,
    views: b.views,
    pct: (b.views / starts) * 100,
  }));
  const maxPct = Math.max(...pts.map((p) => p.pct));
  // Rewatch peaks legitimately exceed 100% — give them room, but cap the
  // scale so one pathological spike can't flatten the curve.
  const yMax = Math.min(Math.max(110, Math.ceil(maxPct / 10) * 10), 200);

  const W = 760;
  const H = 220;
  const ML = 40;
  const MR = 10;
  const MT = 10;
  const MB = 26;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;
  const n = pts.length;
  const x = (i: number) => ML + (n > 1 ? (i / (n - 1)) * plotW : 0);
  const y = (pct: number) => MT + plotH - (Math.min(pct, yMax) / yMax) * plotH;

  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`)
    .join("");
  const area = `${line}L${x(n - 1).toFixed(1)},${(MT + plotH).toFixed(1)}L${ML},${(
    MT + plotH
  ).toFixed(1)}Z`;

  // x tick every minute (6 buckets), thinned to ≤10 ticks.
  const bucketsPerMin = 60 / curve.bucketSeconds;
  const minuteTicks: number[] = [];
  for (let i = 0; i < n; i += bucketsPerMin) minuteTicks.push(i);
  const tickEvery = Math.max(1, Math.ceil(minuteTicks.length / 10));
  const yTicks = [0, 25, 50, 75, 100].filter((v) => v <= yMax);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={labels.yAxis}
    >
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={ML}
            x2={W - MR}
            y1={y(v)}
            y2={y(v)}
            stroke="#f6efe4"
            strokeOpacity={v === 100 ? 0.2 : 0.07}
            strokeDasharray={v === 100 ? "4 3" : undefined}
          />
          <text
            x={ML - 5}
            y={y(v) + 3}
            textAnchor="end"
            className="fill-cream/35 text-[9px] font-mono"
          >
            {v}%
          </text>
        </g>
      ))}
      <path d={area} fill={ACCENT} fillOpacity="0.14" />
      <path
        d={line}
        fill="none"
        stroke={ACCENT}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {minuteTicks
        .filter((_, idx) => idx % tickEvery === 0)
        .map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-cream/35 text-[8.5px] font-mono"
          >
            {fmtMmSs(i * curve.bucketSeconds)}
          </text>
        ))}
      {/* hover columns */}
      {pts.map((p, i) => (
        <rect
          key={p.bucket}
          x={i === 0 ? ML : x(i) - plotW / n / 2}
          y={MT}
          width={plotW / Math.max(n - 1, 1)}
          height={plotH}
          fill="transparent"
        >
          <title>
            {`${fmtMmSs(p.bucket * curve.bucketSeconds)} · ${Math.round(p.pct)}% (${p.views} ${labels.views})`}
          </title>
        </rect>
      ))}
    </svg>
  );
}

// ---- Block 6 widget: completion rate vs episode length ---------------------

export function DurationCompletionPlot({
  items,
  emptyLabel,
}: {
  items: { label: string; durationMinutes: number; completionRate: number }[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-cream/55">{emptyLabel}</p>
    );
  }
  const W = 340;
  const H = 170;
  const ML = 34;
  const MR = 10;
  const MT = 8;
  const MB = 26;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;
  const xMax = Math.max(...items.map((i) => i.durationMinutes), 10);
  const x = (min: number) => ML + (min / xMax) * plotW;
  const y = (pct: number) => MT + plotH - (pct / 100) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line
            x1={ML}
            x2={W - MR}
            y1={y(v)}
            y2={y(v)}
            stroke="#f6efe4"
            strokeOpacity="0.08"
          />
          <text
            x={ML - 4}
            y={y(v) + 3}
            textAnchor="end"
            className="fill-cream/35 text-[8.5px] font-mono"
          >
            {v}%
          </text>
        </g>
      ))}
      {[Math.round(xMax / 2), Math.round(xMax)].map((v) => (
        <text
          key={v}
          x={x(v)}
          y={H - 8}
          textAnchor="middle"
          className="fill-cream/35 text-[8.5px] font-mono"
        >
          {v}m
        </text>
      ))}
      {items.map((it) => (
        <circle
          key={it.label}
          cx={x(it.durationMinutes)}
          cy={y(it.completionRate)}
          r={4.5}
          fill={ACCENT}
          fillOpacity="0.85"
          stroke="#0f0a07"
          strokeWidth="1.5"
        >
          <title>{`${it.label} · ${Math.round(it.durationMinutes)}m · ${Math.round(it.completionRate)}%`}</title>
        </circle>
      ))}
    </svg>
  );
}
