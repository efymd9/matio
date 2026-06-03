import type { NextConfig } from "next";

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
