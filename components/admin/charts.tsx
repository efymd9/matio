import Link from "next/link";

// Static, dependency-free chart primitives for the admin analytics dashboard.
// SVG + Tailwind, theme-matched (accent #ff3d3d). Server components — no client
// JS — using native `title` tooltips. The one interactive chart (metric switch)
// lives in components/admin/time-series.tsx.

const ACCENT = "#ff3d3d";
const GOOD = "#7fd87a";

function fmtPct(n: number): string {
  const v = Math.abs(n);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
}

// ---- KPI tile with period-over-period delta + optional sparkline -----------

export function KpiTile({
  label,
  value,
  sub,
  current,
  prev,
  spark,
  approx,
  goodWhenDown,
}: {
  label: string;
  value: string;
  sub?: string;
  // Pass current+prev to render a period-over-period delta chip.
  current?: number;
  prev?: number;
  spark?: number[];
  approx?: boolean;
  goodWhenDown?: boolean;
}) {
  const showDelta = current !== undefined && prev !== undefined;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.08em] text-white/55">
          {label}
          {approx ? (
            <span
              className="ml-1 rounded bg-white/10 px-1 py-0.5 text-[8px] font-bold text-white/50"
              title="Approximate — derived from last-saved playhead, not cumulative watch time"
            >
              APPROX
            </span>
          ) : null}
        </p>
        {spark && spark.length > 1 ? <Sparkline data={spark} /> : null}
      </div>
      <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-white">
        {value}
      </p>
      <div className="mt-0.5 flex items-center gap-2">
        {showDelta ? (
          <DeltaChip current={current!} prev={prev!} goodWhenDown={goodWhenDown} />
        ) : null}
        {sub ? <p className="text-[11px] text-white/45">{sub}</p> : null}
      </div>
    </div>
  );
}

// Delta chip rendered when a previous-period value is available.
export function DeltaChip({
  current,
  prev,
  goodWhenDown,
}: {
  current: number;
  prev: number;
  goodWhenDown?: boolean;
}) {
  if (prev === 0 && current === 0) {
    return <span className="text-[11px] text-white/35">no change</span>;
  }
  if (prev === 0) {
    return (
      <span className="text-[11px] font-semibold text-[#7fd87a]">new</span>
    );
  }
  const delta = ((current - prev) / prev) * 100;
  const up = delta >= 0;
  const positive = goodWhenDown ? !up : up;
  const color = delta === 0 ? "#9ca3af" : positive ? GOOD : ACCENT;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[11px] font-semibold"
      style={{ color }}
      title={`vs previous period (${prev})`}
    >
      {delta === 0 ? "" : up ? "▲" : "▼"} {fmtPct(delta)}
    </span>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const w = 64;
  const h = 20;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="opacity-70">
      <polyline
        points={pts}
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---- Ranked horizontal bar list (top shows / channels / Mux per-show) ------

export type BarItem = {
  label: string;
  value: number;
  sub?: string;
  href?: string;
};

export function BarList({
  items,
  format,
  emptyLabel = "No data yet.",
}: {
  items: BarItem[];
  format: (n: number) => string;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-white/55">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => {
        const pct = (it.value / max) * 100;
        const label = it.href ? (
          <Link
            href={it.href}
            className="w-40 shrink-0 truncate text-sm font-semibold text-white transition-colors hover:text-[#ff3d3d]"
          >
            {it.label}
          </Link>
        ) : (
          <span className="w-40 shrink-0 truncate text-sm font-semibold text-white">
            {it.label}
          </span>
        );
        return (
          <li key={`${it.label}-${i}`} className="flex items-center gap-3">
            <span className="w-5 shrink-0 font-mono text-xs text-white/40">
              {i + 1}
            </span>
            {label}
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-[#ff3d3d]" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right font-mono text-[11px] leading-tight text-white/65">
              {format(it.value)}
              {it.sub ? <span className="block text-white/35">{it.sub}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Acquisition funnel ----------------------------------------------------

export type FunnelStep = { label: string; value: number; hint?: string };

export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.value ?? 0;
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const ofTop = top > 0 ? (s.value / top) * 100 : 0;
        const prev = i > 0 ? steps[i - 1].value : null;
        const stepPct =
          prev && prev > 0 ? (s.value / prev) * 100 : i === 0 ? 100 : 0;
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-semibold text-white">{s.label}</span>
              <span className="font-mono text-white/55">
                {s.value.toLocaleString()}
                {i > 0 ? (
                  <span className="ml-2 text-white/35">{fmtPct(stepPct)} of prev</span>
                ) : null}
              </span>
            </div>
            <div
              className="mt-1 h-7 overflow-hidden rounded-md bg-white/[0.04]"
              title={s.hint}
            >
              <div
                className="flex h-full items-center rounded-md bg-gradient-to-r from-[#ff3d3d] to-[#ff5e3d] pl-2"
                style={{ width: `${Math.max(ofTop, s.value > 0 ? 3 : 0)}%` }}
              >
                <span className="text-[10px] font-bold text-white/90">
                  {fmtPct(ofTop)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Vertical histogram (trial preview depth) ------------------------------

export function Histogram({ bars }: { bars: { label: string; n: number }[] }) {
  const max = Math.max(...bars.map((b) => b.n), 1);
  const total = bars.reduce((a, b) => a + b.n, 0);
  return (
    <div>
      <div className="flex h-32 items-end gap-1.5">
        {bars.map((b) => (
          <div
            key={b.label}
            className="group/bar flex h-full flex-1 flex-col items-center justify-end"
            title={`${b.label}: ${b.n}${total > 0 ? ` (${fmtPct((b.n / total) * 100)})` : ""}`}
          >
            <div
              className={`w-full rounded-sm transition-colors ${
                b.n > 0 ? "bg-[#ff3d3d]/70 group-hover/bar:bg-[#ff3d3d]" : "bg-white/[0.04]"
              }`}
              style={{ height: `${Math.max((b.n / max) * 100, b.n > 0 ? 4 : 1)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {bars.map((b) => (
          <span
            key={b.label}
            className="flex-1 text-center font-mono text-[9px] text-white/35"
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- Donut (subscription status mix) ---------------------------------------

const STATUS_COLORS: Record<string, string> = {
  active: GOOD,
  trialing: "#5ab0ff",
  past_due: "#f5c451",
  canceled: "#9ca3af",
};

export function Donut({
  segments,
}: {
  segments: { label: string; value: number }[];
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    return <p className="py-6 text-center text-sm text-white/55">No subscriptions yet.</p>;
  }
  const r = 42;
  const c = 2 * Math.PI * r;
  // Precompute each arc's start offset (cumulative prior fraction) without
  // mutating across the render map — the lint rule forbids post-render reassign.
  const arcs = segments.map((s, i) => {
    const priorValue = segments
      .slice(0, i)
      .reduce((acc, x) => acc + x.value, 0);
    return {
      label: s.label,
      dash: (s.value / total) * c,
      offset: (priorValue / total) * c,
    };
  });
  return (
    <div className="flex items-center gap-5">
      <svg width="110" height="110" viewBox="0 0 110 110" className="shrink-0">
        <g transform="translate(55,55) rotate(-90)">
          {arcs.map((a) => (
            <circle
              key={a.label}
              r={r}
              fill="none"
              stroke={STATUS_COLORS[a.label] ?? ACCENT}
              strokeWidth="14"
              strokeDasharray={`${a.dash} ${c - a.dash}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </g>
        <text
          x="55"
          y="50"
          textAnchor="middle"
          className="fill-white text-[18px] font-extrabold"
        >
          {total}
        </text>
        <text x="55" y="66" textAnchor="middle" className="fill-white/45 text-[8px]">
          subs
        </text>
      </svg>
      <ul className="space-y-1.5 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="inline-block size-2.5 rounded-sm"
              style={{ background: STATUS_COLORS[s.label] ?? ACCENT }}
            />
            <span className="text-white/70">{s.label}</span>
            <span className="font-mono text-white/45">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
