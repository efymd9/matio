import { Suspense } from "react";
import Link from "next/link";
import {
  loadContentTable,
  loadCountryOptions,
  loadPulse,
  loadReleaseStats,
  loadRetentionCurve,
  loadSourceGeoMatrix,
  loadSpecFunnel,
  loadSpecGeo,
  loadSpecKpis,
  loadWatchTimeWidget,
  parseSpecFilters,
  shapeReleaseRetention,
  type ContentRow,
  type SpecFilters,
} from "@/lib/admin-analytics-v2";
import { paymentsEnabled } from "@/lib/free-mode";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { FunnelChart, KpiTile } from "@/components/admin/charts";
import {
  DurationCompletionPlot,
  PulseChart,
  RetentionCurveChart,
} from "@/components/admin/spec-charts";
import { AnalyticsTabs } from "@/components/admin/analytics-tabs";
import { SpecAnalyticsFilters } from "@/components/admin/spec-filters";
import { WorldMap } from "@/components/admin/world-map";
import { WORLD_TILE_GRID } from "@/lib/world-map-grid";
import { LegacyDashboard } from "./legacy-dashboard";

type SearchParams = Record<string, string | string[] | undefined>;

export const dynamic = "force-dynamic";

const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(WORLD_TILE_GRID).map(([iso, t]) => [iso, t.name]),
);

function countryName(iso: string | null | undefined, unknownLabel: string) {
  if (!iso) return unknownLabel;
  return COUNTRY_NAMES[iso] ?? iso;
}

function fmtPctOrDash(v: number | null, dash: string): string {
  return v == null ? dash : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
}

function fmtMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Serialize the current filter state back into a query string, with a
// patch — used by the episode-table links so selecting a curve keeps the
// period/source/geo intact.
function qs(f: SpecFilters, patch: Record<string, string | null>): string {
  const params = new URLSearchParams();
  if (f.preset !== "30d") params.set("range", f.preset);
  if (f.customFrom) params.set("from", f.customFrom);
  if (f.customTo) params.set("to", f.customTo);
  if (f.source !== "all") params.set("src", f.source);
  if (f.country !== "all") params.set("geo", f.country);
  if (f.window !== 7) params.set("w", String(f.window));
  if (f.episode) params.set("ep", f.episode);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : "?";
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Paid mode keeps the untouched legacy dashboard (dormant while the
  // free pivot holds — the spec'd page below is the free-mode dashboard).
  if (paymentsEnabled()) {
    return <LegacyDashboard searchParams={searchParams} />;
  }

  const { t } = await getAdminDict();
  const ts = t.analyticsSpec;
  const sp = await searchParams;
  const f = parseSpecFilters(sp, new Date());
  const countries = await loadCountryOptions();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            {ts.eyebrow}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-cream">
            {ts.heading}
          </h1>
          <p className="mt-1 text-sm text-cream/55">
            {`${f.from.toISOString().slice(0, 10)} → ${f.to.toISOString().slice(0, 10)}`}
            {f.source !== "all" ? ` · ${f.source}` : ""}
            {f.country !== "all"
              ? ` · ${countryName(f.country, ts.geoUnknown)}`
              : ""}
          </p>
        </div>
        <p className="max-w-xs text-right text-[11px] leading-snug text-cream/40">
          {ts.ledgerNote}
        </p>
      </div>

      <AnalyticsTabs active="overview" />

      <SpecAnalyticsFilters
        filters={f}
        countries={countries}
        countryNames={COUNTRY_NAMES}
      />

      <Suspense fallback={<RowSkeleton n={4} />}>
        <KpiRow f={f} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title={ts.sectionPulse} />}>
        <PulseSection f={f} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title={ts.sectionFunnel} />}>
        <FunnelSection f={f} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title={ts.sectionGeo} />}>
        <GeoSection f={f} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title={ts.sectionMatrix} />}>
        <MatrixSection f={f} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title={ts.sectionContent} />}>
        <ContentSection f={f} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title={ts.sectionRelease} />}>
        <ReleaseSection f={f} />
      </Suspense>
    </div>
  );
}

// ---- Block 1: KPI row ------------------------------------------------------

async function KpiRow({ f }: { f: SpecFilters }) {
  const { t } = await getAdminDict();
  const ts = t.analyticsSpec;
  const k = await loadSpecKpis(f);
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <KpiTile
        label={ts.kpiVisits}
        value={k.visits.current.toLocaleString()}
        current={k.visits.current}
        prev={k.visits.previous}
      />
      <KpiTile
        label={ts.kpiRegistrations}
        value={k.registrations.current.toLocaleString()}
        current={k.registrations.current}
        prev={k.registrations.previous}
        sub={
          k.registrations.conversion != null
            ? ts.kpiConversion(fmtPctOrDash(k.registrations.conversion, ts.na))
            : undefined
        }
      />
      <KpiTile
        label={ts.kpiNorthStar}
        value={fmtPctOrDash(k.northStar.current, ts.na)}
        current={k.northStar.current ?? 0}
        prev={k.northStar.previous ?? 0}
        sub={ts.kpiNorthStarSub(k.northStar.deepWatchers, k.northStar.newUsers)}
      />
      <KpiTile
        label={ts.kpiReleaseRetention}
        value={fmtPctOrDash(k.releaseRetention.current, ts.na)}
        current={k.releaseRetention.current ?? 0}
        prev={k.releaseRetention.previous ?? 0}
        sub={ts.kpiReleaseRetentionSub(
          k.releaseRetention.returned,
          k.releaseRetention.finishers,
        )}
      />
    </div>
  );
}

// ---- Block 2: pulse --------------------------------------------------------

async function PulseSection({ f }: { f: SpecFilters }) {
  const { t } = await getAdminDict();
  const ts = t.analyticsSpec;
  const pulse = await loadPulse(f);
  const net = pulse.netWeek.new - pulse.netWeek.lost;
  const hasData = pulse.points.some(
    (p) => p.wau > 0 || p.newUsers > 0 || p.lost > 0,
  );
  return (
    <Section title={ts.sectionPulse} hint={ts.pulseHint(pulse.windowDays)}>
      <div className="mb-3 flex items-baseline gap-3">
        <p className="text-2xl font-extrabold tracking-tight text-cream">
          {net > 0 ? `+${net}` : net}
        </p>
        <p className="text-sm text-cream/55">
          {ts.pulseNetWeek(pulse.netWeek.new, pulse.netWeek.lost)}
        </p>
      </div>
      {hasData ? (
        <PulseChart
          data={pulse}
          labels={{
            wau: ts.pulseWau(pulse.windowDays),
            newUsers: ts.pulseNew,
            returning: ts.pulseReturning,
            lost: ts.pulseLost,
            release: ts.pulseRelease,
          }}
        />
      ) : (
        <p className="py-8 text-center text-sm text-cream/55">{ts.freshNote}</p>
      )}
    </Section>
  );
}

// ---- Block 3: full funnel --------------------------------------------------

async function FunnelSection({ f }: { f: SpecFilters }) {
  const { t } = await getAdminDict();
  const ts = t.analyticsSpec;
  const fu = await loadSpecFunnel(f);
  return (
    <Section title={ts.sectionFunnel} hint={ts.funnelHint}>
      {fu.cohort === 0 ? (
        <p className="py-8 text-center text-sm text-cream/55">{ts.freshNote}</p>
      ) : (
        <FunnelChart
          steps={[
            {
              label: ts.fVisited,
              value: fu.cohort,
              hint: ts.fVisitedHint(fu.landedHome),
            },
            { label: ts.fShow, value: fu.showViewed },
            { label: ts.fWall, value: fu.wallSeen },
            { label: ts.fRegistered, value: fu.registered },
            { label: ts.fStarted, value: fu.started },
            { label: ts.f25, value: fu.d25 },
            { label: ts.f50, value: fu.d50 },
            { label: ts.f80, value: fu.d80 },
            { label: ts.f100, value: fu.d100 },
          ]}
        />
      )}
    </Section>
  );
}

// ---- Block 4: geo ----------------------------------------------------------

async function GeoSection({ f }: { f: SpecFilters }) {
  const { t } = await getAdminDict();
  const ts = t.analyticsSpec;
  const geo = await loadSpecGeo(f);
  const rows = geo.rows.filter((r) => r.visits > 0 || r.registrations > 0);
  return (
    <Section title={ts.sectionGeo} hint={ts.geoHint}>
      <div className="grid gap-5 lg:grid-cols-2">
        <WorldMap
          data={geo.mapData}
          emptyLabel={ts.geoEmpty}
          formatValue={(n) => ts.geoMapValue(n)}
        />
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-cream/55">
              {ts.freshNote}
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-wide text-cream/45">
                  <th className="py-2 pr-3">{ts.thCountry}</th>
                  <th className="py-2 pr-3 text-right">{ts.thVisits}</th>
                  <th className="py-2 pr-3 text-right">{ts.thConversion}</th>
                  <th className="py-2 pr-3 text-right">{ts.thCompletion}</th>
                  <th className="py-2 text-right">{ts.thReleaseRet}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 12).map((r) => (
                  <tr
                    key={r.country || "unknown"}
                    className="border-b border-white/[0.04]"
                  >
                    <td className="py-2 pr-3 font-semibold text-cream">
                      {countryName(r.country || null, ts.geoUnknown)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-cream/70">
                      {r.visits.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-cream/70">
                      {r.visits > 0
                        ? fmtPctOrDash((r.registrations / r.visits) * 100, ts.na)
                        : ts.na}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-cream/70">
                      {fmtPctOrDash(r.completionRate, ts.na)}
                    </td>
                    <td className="py-2 text-right font-mono text-cream/70">
                      {fmtPctOrDash(r.releaseRetention, ts.na)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Section>
  );
}

// ---- Block 5: source × geo matrix ------------------------------------------

async function MatrixSection({ f }: { f: SpecFilters }) {
  const { t } = await getAdminDict();
  const ts = t.analyticsSpec;
  const m = await loadSourceGeoMatrix(f);
  const cellByKey = new Map(m.cells.map((c) => [`${c.source}|${c.country}`, c]));
  const sources = ["tiktok", "ig", "fb", "direct", "other"] as const;
  const SOURCE_LABELS: Record<string, string> = {
    tiktok: "TikTok",
    ig: "Instagram",
    fb: "Facebook",
    direct: "Direct",
    other: ts.sourceOther,
  };
  return (
    <Section title={ts.sectionMatrix} hint={ts.matrixHint}>
      {m.countries.length === 0 ? (
        <p className="py-8 text-center text-sm text-cream/55">{ts.freshNote}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wide text-cream/45">
                <th className="py-2 pr-3">{ts.thSource}</th>
                {m.countries.map((c) => (
                  <th key={c} className="px-2 py-2 text-right">
                    {countryName(c, ts.geoUnknown)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3 font-semibold text-cream">
                    {SOURCE_LABELS[s]}
                  </td>
                  {m.countries.map((c) => {
                    const cell = cellByKey.get(`${s}|${c}`);
                    const deep = cell?.deepWatch ?? null;
                    // Heat encodes the QUALITY signal (deep watch), the
                    // numbers carry both values — color is redundant.
                    const heat =
                      deep == null ? 0 : Math.min(0.38, (deep / 100) * 0.45);
                    return (
                      <td
                        key={c}
                        className="px-2 py-2 text-right font-mono"
                        style={{
                          background:
                            heat > 0
                              ? `rgba(230, 179, 102, ${heat})`
                              : undefined,
                        }}
                        title={
                          cell
                            ? `${SOURCE_LABELS[s]} · ${countryName(c, ts.geoUnknown)}: ${ts.matrixCellTitle(
                                cell.visits,
                                cell.registrations,
                              )}`
                            : undefined
                        }
                      >
                        {cell && cell.visits > 0 ? (
                          <span className="text-cream/85">
                            {fmtPctOrDash(cell.regConversion, ts.na)}
                            <span className="text-cream/40"> · </span>
                            {fmtPctOrDash(deep, ts.na)}
                          </span>
                        ) : (
                          <span className="text-cream/25">{ts.na}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-cream/40">{ts.matrixCellHint}</p>
        </div>
      )}
    </Section>
  );
}

// ---- Block 6: content ------------------------------------------------------

async function ContentSection({ f }: { f: SpecFilters }) {
  const { t } = await getAdminDict();
  const ts = t.analyticsSpec;
  const [rows, widget] = await Promise.all([
    loadContentTable(f),
    loadWatchTimeWidget(f),
  ]);
  const selectedId =
    f.episode ??
    rows.reduce<ContentRow | null>(
      (best, r) => (r.starts > (best?.starts ?? 0) ? r : best),
      null,
    )?.episodeId ??
    null;
  const curve = selectedId ? await loadRetentionCurve(selectedId, f) : null;
  const plotItems = rows
    .filter((r) => r.durationSeconds && r.starts > 0 && r.completionRate != null)
    .map((r) => ({
      label: `${r.showTitle} S${r.seasonNumber}E${r.episodeNumber}`,
      durationMinutes: r.durationSeconds! / 60,
      completionRate: r.completionRate!,
    }));

  return (
    <Section title={ts.sectionContent} hint={ts.contentHint}>
      {/* watch-time argument widget */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <MiniStat
          label={ts.widgetAvgPerDay}
          value={
            widget.avgPerViewerDay != null
              ? fmtMmSs(widget.avgPerViewerDay)
              : ts.na
          }
        />
        <MiniStat
          label={ts.widgetTotal}
          value={`${(widget.totalWatchedSeconds / 3600).toFixed(1)}${ts.hoursSuffix}`}
        />
        <MiniStat
          label={ts.widgetViewerDays}
          value={widget.viewerDays.toLocaleString()}
        />
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-cream/55">{ts.freshNote}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wide text-cream/45">
                <th className="py-2 pr-3">{ts.thEpisode}</th>
                <th className="py-2 pr-3 text-right">{ts.thStarts}</th>
                <th className="py-2 pr-3 text-right">{ts.thCompletionRate}</th>
                <th className="py-2 pr-3 text-right">{ts.thAvgWatched}</th>
                <th className="py-2 text-right">{ts.thRewatches}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const selected = r.episodeId === selectedId;
                return (
                  <tr
                    key={r.episodeId}
                    className={`border-b border-white/[0.04] ${
                      selected ? "bg-gold/[0.08]" : ""
                    }`}
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={qs(f, { ep: r.episodeId })}
                        scroll={false}
                        className={`font-semibold transition-colors hover:text-gold ${
                          selected ? "text-gold" : "text-cream"
                        }`}
                      >
                        {r.showTitle} · S{r.seasonNumber}E{r.episodeNumber}{" "}
                        <span className="text-cream/45">{r.title}</span>
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-cream/70">
                      {r.starts.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-cream/70">
                      {fmtPctOrDash(r.completionRate, ts.na)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-cream/70">
                      {fmtPctOrDash(r.avgWatchedPct, ts.na)}
                    </td>
                    <td className="py-2 text-right font-mono text-cream/70">
                      {r.rewatchers.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {curve ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h3 className="mb-2 text-xs font-bold text-cream">
              {ts.curveTitle(
                `${curve.showTitle} · S${curve.seasonNumber}E${curve.episodeNumber} ${curve.title}`,
              )}
            </h3>
            <RetentionCurveChart
              curve={curve}
              labels={{
                yAxis: ts.curveYAxis,
                views: ts.curveViews,
                noData: ts.curveNoData,
              }}
            />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold text-cream">
              {ts.durationPlotTitle}
            </h3>
            <DurationCompletionPlot
              items={plotItems}
              emptyLabel={ts.freshNote}
            />
          </div>
        </div>
      ) : null}
    </Section>
  );
}

// ---- Block 7: release retention per show -----------------------------------

async function ReleaseSection({ f }: { f: SpecFilters }) {
  const { t } = await getAdminDict();
  const ts = t.analyticsSpec;
  const stats = await loadReleaseStats();
  const showsData = shapeReleaseRetention(stats, f);
  const withPairs = showsData.filter((s) => s.pairs.length > 0);
  return (
    <Section title={ts.sectionRelease} hint={ts.releaseHint}>
      {withPairs.length === 0 ? (
        <p className="py-8 text-center text-sm text-cream/55">
          {ts.releaseEmpty}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {withPairs.map((s) => (
            <div
              key={s.showId}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <p className="mb-2 text-sm font-bold text-cream">{s.showTitle}</p>
              <ul className="space-y-2">
                {s.pairs.map((p) => (
                  <li key={p.label} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-cream/70">{p.label}</span>
                      <span className="font-mono text-cream/55">
                        {p.pct != null
                          ? `${Math.round(p.pct)}% (${p.returned}/${p.finishers})`
                          : ts.na}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gold"
                        style={{ width: `${Math.min(p.pct ?? 0, 100)}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[10px] text-cream/35">
                      {p.nextTitle}
                      {p.release
                        ? ` · ${p.release.toISOString().slice(0, 10)}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---- Shared shells ---------------------------------------------------------

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-[0.08em] text-cream/50">
        {label}
      </p>
      <p className="mt-1 text-lg font-extrabold tracking-tight text-cream">
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-white">{title}</h2>
        {hint ? (
          <span className="text-right text-[11px] text-white/45">{hint}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <Section title={title}>
      <div className="h-40 animate-pulse rounded-lg bg-white/[0.03]" />
    </Section>
  );
}

function RowSkeleton({ n }: { n: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]"
        />
      ))}
    </div>
  );
}
