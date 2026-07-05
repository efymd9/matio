import type { NextConfig } from "next";

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

export default nextConfig;
