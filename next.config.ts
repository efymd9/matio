import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Mux image service hosts every poster + thumbnail. Anything not
    // listed here falls through to raw <img>.
    remotePatterns: [
      { protocol: "https", hostname: "image.mux.com" },
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
