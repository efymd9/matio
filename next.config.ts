import { readFileSync } from "node:fs";

import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// The product version, single-sourced from package.json — which release-please
// bumps when a Release PR is merged (release-please-config.json). Inlined at
// build time and served by /api/healthz, so "which version is actually live"
// is answered by curl instead of by reading the deploy history.
const { version: packageVersion } = JSON.parse(
  readFileSync("./package.json", "utf8"),
) as { version: string };

// Fail the PRODUCTION build (Vercel) if a required live-Stripe price env var is
// missing, instead of shipping a deployment whose subscribe checkout actions
// throw at runtime. A failed build leaves the previous (working) deployment
// serving, so a forgotten `vercel env add` can't cause a checkout outage.
// Scoped to VERCEL_ENV === "production" so local `next dev` / `next build` and
// preview deploys (env not always present) are unaffected.
// Also scoped to PAYMENTS_ENABLED === "1" (inlined here — next.config.ts can't
// resolve the `@/` alias to lib/free-mode.ts, and that module is server-only):
// with payments off the checkout actions guard-return before reading these, so
// a free-mode Stripe env cleanup must not brick every subsequent build. NB
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_MONTHLY stay
// runtime dependencies of the webhook mirror while any live subscriber exists.
if (
  process.env.VERCEL_ENV === "production" &&
  process.env.PAYMENTS_ENABLED === "1"
) {
  for (const key of ["STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_TRIAL_FEE"]) {
    if (!process.env[key]) {
      throw new Error(
        `${key} must be set for production builds (required by app/subscribe checkout actions).`,
      );
    }
  }
}

const nextConfig: NextConfig = {
  env: {
    // An explicit APP_VERSION (e.g. injected by a CI deploy) wins; otherwise
    // package.json is the source of truth.
    APP_VERSION: process.env.APP_VERSION ?? packageVersion,
  },
  // PostHog recommends posting analytics through a same-origin path so ad
  // blockers don't drop ingestion and the SDK's cookies stay first-party.
  // Middleware (proxy.ts) runs BEFORE these rewrites, so /ingest is excluded
  // from the proxy matcher (see proxy.ts) to skip Clerk auth on every beacon.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
  images: {
    // Mux image service hosts every video thumbnail; Vercel Blob hosts admin-
    // uploaded show artwork (poster + hero). Anything not listed here falls
    // through to raw <img>. The Blob host is `<storeId>.public.blob.vercel-
    // storage.com`, so a single-level wildcard covers any store.
    remotePatterns: [
      { protocol: "https", hostname: "image.mux.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
  experimental: {
    // Tree-shake barrel imports so importing one symbol from these
    // packages doesn't drag the whole module graph into the client bundle.
    optimizePackageImports: [
      "@clerk/nextjs",
      "@base-ui/react",
      "lucide-react",
      "media-chrome",
    ],
  },
};

// Sentry's build-time wrapper: source-map upload (so a stack trace names our
// code instead of a minified chunk) and the SDK's build instrumentation.
//
// APPLIED ONLY WHEN A DSN EXISTS. Without one the export is the plain config
// above — byte for byte the build we had before Sentry — which is what makes
// `pnpm build` with no Sentry variables at all a no-op rather than a leap of
// faith. Source maps additionally need `SENTRY_AUTH_TOKEN`; without it the
// plugin prints a warning and the build still succeeds.
//
// No `tunnelRoute` on purpose: we already proxy PostHog through /ingest, and a
// second same-origin tunnel is more moving parts than the ad-blocked events are
// worth (a blocked error report is our loss, not the viewer's).
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      // Quiet locally, loud in CI — where a failed upload is worth reading.
      silent: !process.env.CI,
      telemetry: false,
      // Never leave uploaded source maps sitting in the deployed output: they
      // are our source code, served publicly, for anyone who guesses the path.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;
