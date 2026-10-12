import type { MetadataRoute } from "next";
import { paymentsEnabled } from "@/lib/free-mode";
import { en } from "@/lib/i18n/dictionaries";

// Web app manifest. Next auto-emits <link rel="manifest"> from this file.
// English — the site's only language since #445.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Matio",
    short_name: "Matio",
    description: paymentsEnabled()
      ? en.metadata.siteDescription
      : en.metadata.siteDescriptionFree,
    start_url: "/",
    display: "standalone",
    background_color: "#0f0a07",
    theme_color: "#0f0a07",
    lang: "en",
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
