import type { MetadataRoute } from "next";
import { es } from "@/lib/i18n/dictionaries";

// Web app manifest. Next auto-emits <link rel="manifest"> from this file.
// It's a cached route, so hard-code the Spanish (indexed-default) copy —
// getLocale() can't run here (it reads headers()/cookies(), which would opt
// the route into per-request rendering and is wrong for a crawler/install
// artifact anyway).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Matio",
    short_name: "Matio",
    description: es.metadata.siteDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0c",
    theme_color: "#0a0a0c",
    lang: "es",
    categories: ["entertainment"],
    icons: [
      // Full-bleed "any" + a padded "maskable" variant so Android's adaptive
      // mask doesn't crop the ring. Backgrounds match theme/background_color.
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
