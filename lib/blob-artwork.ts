// Where admin-uploaded artwork lives on Vercel Blob — the ONE list both the
// web's image optimizer (next.config.ts → images.remotePatterns) and the
// app's optimizer-URL builder (lib/api/image-url.ts) read, so the two cannot
// disagree. It used to be a wildcard over every `*.public.blob.vercel-
// storage.com` store, which let anyone run any store's images through
// matio.tv/_next/image on our bill (#306).
//
// UNIVERSAL and dependency-free: next.config.ts loads it at build time, and
// the app bundles it through Metro (via lib/api/image-url.ts).

// Store hosts. Exactly one public store exists — `matio-blob`
// (store_WaoyOcTQyYvecbhm; `vercel blob list-stores`, 27.09.2026). The
// staging project has no store of its own: it renders these same URLs. A new
// store adds its host here, or its images 400 at /_next/image.
export const ARTWORK_BLOB_HOSTS = [
  "waoyoctqyyvecbhm.public.blob.vercel-storage.com",
] as const;

// Top-level folders — the only ones /api/admin/upload-image lets an upload
// write to (its UPLOAD_PATH: shows/poster-*, shows/hero-*, actors/avatar-*).
export const ARTWORK_BLOB_PREFIXES = ["shows", "actors"] as const;
