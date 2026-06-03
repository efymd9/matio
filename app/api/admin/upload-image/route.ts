import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin";

// Client-direct image upload token issuer for admin show artwork (poster +
// hero). The browser calls `upload()` from @vercel/blob/client, which hits
// this route to mint a short-lived, scoped client token, then streams the
// file straight to Vercel Blob — the bytes never pass through our function,
// so we sidestep the ~4.5 MB serverless body limit (same philosophy as the
// Mux video upload going direct via upchunk).
//
// Auth + the content-type / size allowlist live in onBeforeGenerateToken so
// the token Blob issues can only be used for what we permit. A leaked token
// can't upload an executable or an arbitrarily large file.
export const runtime = "nodejs";

const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
];

// 15 MB — comfortably above a 2560×1080 hero JPEG/PNG, below anything that
// would be a mistake (a stray video file, say).
const MAX_BYTES = 15 * 1024 * 1024;

// The client requests a token for `shows/<poster|hero>-<filename>`. The
// pathname is embedded verbatim into the issued client token, so we pin it
// here — otherwise an admin-session caller could mint a token for any path
// in the store. addRandomSuffix then makes the final key unique on top.
const UPLOAD_PATH = /^shows\/(?:poster|hero)-[A-Za-z0-9._-]+$/;

export async function POST(request: Request): Promise<NextResponse> {
  // Parse inside the try so a malformed/probe POST returns the same
  // controlled 400 as everything else (the route is matchable, so it gets
  // hit by bots) rather than escaping as an uncaught 500.
  try {
    const body = (await request.json()) as HandleUploadBody;

    const json = await handleUpload({
      body,
      request,
      // Runs server-side when the client requests an upload token — the only
      // place we can trust. requireAdmin() redirects (wrong for an API), so
      // we gate with getCurrentAdmin() and throw, which handleUpload turns
      // into a 4xx the client surfaces inline.
      onBeforeGenerateToken: async (pathname) => {
        const admin = await getCurrentAdmin();
        if (!admin) throw new Error("Not authorized to upload images");
        if (!UPLOAD_PATH.test(pathname)) {
          throw new Error("Invalid upload path");
        }
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          // Never overwrite an existing blob — each upload gets a unique
          // pathname so re-uploading artwork can't clobber another show's.
          addRandomSuffix: true,
        };
      },
      // No onUploadCompleted: the client receives the final URL from
      // upload()'s return value and writes it into the form, which the
      // existing createShow/updateShow server action persists on submit.
      // (The callback also can't reach localhost during dev, so omitting it
      // keeps dev and prod behaving identically.)
    });

    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}
