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

// An env var that exists but is EMPTY is absent for our purposes. `??` alone
// does not catch that ("" is neither null nor undefined), and empty values are
// routine: a Vercel variable can be defined blank, and our own CI sets CI="".
// Without this the endpoint would answer `"version": ""` — technically a
// response, practically a lie.
const present = (value: string | undefined) => (value ? value : null);

export function GET() {
  return Response.json(
    {
      status: "ok",
      // Bumped by release-please on release, inlined at build time from
      // package.json (next.config.ts). Matches the `vX.Y.Z` git tag.
      version: present(process.env.APP_VERSION) ?? "unknown",
      // Which commit that version was actually built from — the two answer
      // different questions when a release is mid-flight.
      commit: present(process.env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 7) ?? null,
      // WHICH STAGE this is — the answer an incident reads first. Not
      // `VERCEL_ENV` alone: Vercel gives the production branch of ANY project
      // `production`, and staging is its own project whose production branch
      // is `main` — so the staging site called itself production and was
      // indistinguishable from matio.tv by this field. `APP_ENV` is our own
      // marker (`staging` on the staging project) and wins; unset, the answer
      // is exactly what it was before.
      environment:
        present(process.env.APP_ENV) ??
        present(process.env.VERCEL_ENV) ??
        "development",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
