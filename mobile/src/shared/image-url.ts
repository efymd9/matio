// Resized show artwork through the site's image optimizer (#292). Same
// single-relative-path rule as ./design.ts; lib/api/image-url.ts imports only
// the dependency-free lib/seo.ts.
export { optimizedImageSource, optimizedImageUrl } from "../../../lib/api/image-url";
