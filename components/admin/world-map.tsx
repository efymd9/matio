import {
  GRID_COLS,
  GRID_ROWS,
  WORLD_TILE_GRID,
} from "@/lib/world-map-grid";

// Self-contained tile-grid world choropleth for the admin analytics dashboard.
// Pure server component — inline SVG, no client JS, no hooks, native `<title>`
// tooltips. Standalone by design (does NOT import charts.tsx / ui.tsx, which
// are server-only and dict-coupled): drop it anywhere and pass a plain
// iso2 -> value map.
//
// Encoding (per the dataviz method): value is a MAGNITUDE, so the fill is a
// SEQUENTIAL single-hue ramp, light -> dark, quantized into 5 buckets. Zero /
// missing = a muted outline-only tile. Gold ramp matched to the espresso/gold
// admin theme; plain hex (no oklch, so no Safari-<15.4 fallback dance needed).

// Sequential gold ramp, low -> high. Lightness increases monotonically so the
// order reads without color vision. `ink` is the in-tile code color, flipped to
// dark once the fill is bright enough that cream would drop below ~4.5:1.
const RAMP: ReadonlyArray<{ fill: string; ink: string }> = [
  { fill: "#4d3617", ink: "#f6efe4" }, // bucket 0 — lowest
  { fill: "#7d5820", ink: "#f6efe4" }, // bucket 1
  { fill: "#a97c2c", ink: "#241205" }, // bucket 2
  { fill: "#d1a049", ink: "#241205" }, // bucket 3
  { fill: "#eec489", ink: "#241205" }, // bucket 4 — highest (gold-hi)
];

const EMPTY_FILL = "rgba(246, 239, 228, 0.045)"; // faint cream wash on espresso
const EMPTY_STROKE = "rgba(246, 239, 228, 0.12)";
const EMPTY_INK = "#f6efe4";

const TILE = 20;
const GAP = 4;
const PITCH = TILE + GAP;

export type WorldMapProps = {
  /** iso2 (upper-case) -> value. Codes absent from the grid are ignored. */
  data: Record<string, number>;
  /** Formats a value for the tooltip + legend. Default: locale integer. */
  formatValue?: (n: number) => string;
  /** Shown (muted, above the grid) when every value is zero / missing. */
  emptyLabel: string;
  /** Optional caption above the map. */
  title?: string;
};

// Quantile bucketer: splits the nonzero values into 5 bins at the 20/40/60/80th
// percentiles. Quantiles (not linear steps) keep a skewed analytics distribution
// readable — a couple of huge countries won't flatten everyone else into bucket 0.
// Returns -1 for zero/missing (the muted tile).
function makeBucketer(values: number[]): (v: number) => number {
  const pos = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (pos.length === 0) return () => -1;
  const max = pos[pos.length - 1];
  const q = (p: number): number => pos[Math.min(pos.length - 1, Math.floor(p * pos.length))];
  const thresholds = [q(0.2), q(0.4), q(0.6), q(0.8)];
  return (v: number): number => {
    if (!Number.isFinite(v) || v <= 0) return -1;
    if (v >= max) return RAMP.length - 1;
    let b = 0;
    for (const th of thresholds) if (v > th) b += 1;
    return Math.min(b, RAMP.length - 1);
  };
}

export function WorldMap({
  data,
  formatValue = (n) => n.toLocaleString(),
  emptyLabel,
  title,
}: WorldMapProps) {
  const values = Object.values(data);
  const nonzero = values.filter((v) => Number.isFinite(v) && v > 0);
  const isEmpty = nonzero.length === 0;
  const max = isEmpty ? 0 : Math.max(...nonzero);
  const min = isEmpty ? 0 : Math.min(...nonzero);
  const bucketOf = makeBucketer(values);

  const width = GRID_COLS * PITCH - GAP;
  const height = GRID_ROWS * PITCH - GAP;

  const ariaLabel = isEmpty
    ? `${title ?? "World map"} — ${emptyLabel}`
    : `${title ?? "World map"} — ${nonzero.length} countries with data`;

  return (
    <figure className="w-full">
      {title ? (
        <figcaption className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-cream/55">
          {title}
        </figcaption>
      ) : null}

      {isEmpty ? (
        <p className="mb-2 text-center text-sm text-cream/55">{emptyLabel}</p>
      ) : null}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full max-w-full"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        {Object.entries(WORLD_TILE_GRID).map(([iso, tile]) => {
          const value = data[iso] ?? 0;
          const bucket = bucketOf(value);
          const hasData = bucket >= 0;
          const style = hasData ? RAMP[bucket] : { fill: EMPTY_FILL, ink: EMPTY_INK };
          const x = tile.col * PITCH;
          const y = tile.row * PITCH;
          return (
            <g key={iso}>
              <title>{`${tile.name} — ${formatValue(value)}`}</title>
              <rect
                x={x}
                y={y}
                width={TILE}
                height={TILE}
                rx={4}
                ry={4}
                fill={style.fill}
                stroke={hasData ? "none" : EMPTY_STROKE}
                strokeWidth={hasData ? 0 : 1}
              />
              <text
                x={x + TILE / 2}
                y={y + TILE / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={TILE * 0.42}
                fontWeight={700}
                fill={style.ink}
                opacity={hasData ? 1 : 0.4}
                style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
              >
                {iso}
              </text>
            </g>
          );
        })}
      </svg>

      {!isEmpty ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-cream/50">
          <span className="font-mono">{formatValue(min)}</span>
          <div className="flex gap-[3px]" aria-hidden>
            {RAMP.map((s) => (
              <span
                key={s.fill}
                className="inline-block size-3 rounded-[2px]"
                style={{ background: s.fill }}
              />
            ))}
          </div>
          <span className="font-mono">{formatValue(max)}</span>
        </div>
      ) : null}
    </figure>
  );
}
