// Liveness + "what is actually deployed right now".
//
// Deliberately CHEAP: no database, no vendor calls. A health endpoint that
// touches Postgres turns every uptime ping into load and, worse, reports the
// service as down when the DB is merely slow. Real readiness (DB, cache) gets
// its own /readyz — see the observability stage of docs/mega-process/.
//
// Lives under /api rather than at a bare /healthz on purpose: proxy.ts mints
// the first-party `matio_aid` audience cookie on ordinary GET requests and
// skips /api — an uptime monitor must not manufacture visitors.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      // Bumped by release-please on release, inlined at build time from
      // package.json (next.config.ts). Matches the `vX.Y.Z` git tag.
      version: process.env.APP_VERSION ?? "unknown",
      // Which commit that version was actually built from — the two answer
      // different questions when a release is mid-flight.
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      environment: process.env.VERCEL_ENV ?? "development",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
